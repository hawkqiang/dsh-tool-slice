/**
 * tool-slice preset plugin: the model-facing side of the slice workflow.
 *
 * `plan_write` turns a task into a bounded Markdown plan; `step_run` hands one
 * step at a time to a fresh caller-delivered subagent, waits for its report,
 * records the report in the plan, and returns only the report plus the next
 * slice. The parent conversation therefore grows by a few hundred tokens per
 * step instead of carrying the whole working context.
 *
 * The step machinery itself lives in `workflow.mjs`, because the `/slice`
 * command and the dock's buttons run the same operation.
 */
import {
  ensureCwd, planFile, readPlanFile, writePlanFile, touchPlanIndex, runStep, shortSession,
} from './workflow.mjs'
import { STATUS, mergePlan } from './core.mjs'

export const name = 'tool-slice-step-tools'
// Only core services are required: a profile without delegation or a
// working-directory provider must still be able to load the lean preset, so
// `subagents` and `workingDirectory` are resolved lazily at call time.
export const inject = ['tools', 'systemPrompt']

const MAX_STEPS = 40

const SECTION = `## 切片工作法（必须遵守）

面对需要动手的任务，先讨论，再拆解，然后逐步执行：

1. 目标如果不明确，先用 ask_user_question 问 1–3 个关键问题（一次问完），不要靠猜。
2. 用 plan_write 把目标拆成 3–8 个独立小步；每步只做一件事，写清「做什么」和「完成标准」。计划会存成 Markdown 文件，用户能直接读。
3. 计划写完后**停下来**：用不超过 8 行复述计划要点，等用户确认。除非用户已经明确说了「开始」「直接做」或自己点了「执行下一步」，否则不要调用 step_run。
4. 用户确认后才调用 step_run：它把「当前这一步」交给一个全新的子代理执行。子代理看不到当前对话，只看到这一步的目标、完成标准和此前各步的一句话结果，它会真正改文件、跑命令、做验证。
5. 读 step_run 返回的报告和下一步切片，继续调用 step_run。不要自己重做子代理已经完成的事，也不要一次把后面所有步骤都写进对话。
6. 用户要改计划时，按他的意见重新调用 plan_write 写整份计划——已完成的步骤和报告会自动保留，你只改没做的部分。改完同样停下等确认。
7. 全部完成后，用 5–10 行中文总结：改了什么、怎么验证的、还剩什么问题。

铁律：
- 计划的唯一事实来源是那个 Markdown 文件，不要在对话里复述或重写整份计划。
- 一次只推进一步；某步报告不合格时，用同一个 step 号再调用一次 step_run 重跑。
- 读文件只读与当前步相关的片段，不要整篇通读；工具结果很长时不要复述。
- 先查证再动手，不确定就用 read/grep 查，不要猜。`

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({ name: 'workflow:slice', order: 1500, text: SECTION }))
  for (const definition of createStepTools(ctx)) {
    ctx.effect(() => ctx.tools.register(definition))
  }
}

/**
 * Build the two model-facing tool definitions. Split out so the workflow can
 * be exercised with a fake context in tests.
 * @param {{workingDirectory?: object, subagents?: object}} ctx
 * @returns {Array<object>} plain ToolDefinition objects
 */
export function createStepTools(ctx) {
  return [
    {
      name: 'plan_write',
      description:
        '把任务拆解成分步计划，并写入 Markdown 文件。先用它拆解，再用 step_run 逐步执行。'
        + '每步写 title（短标题）、task（这一步具体做什么）、done（可检查的完成标准）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['goal', 'steps'],
        properties: {
          goal: { type: 'string', description: '一句话说清最终要达成的结果' },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_STEPS,
            description: '按执行顺序排列的步骤',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'task'],
              properties: {
                title: { type: 'string', description: '不超过 20 字的短标题' },
                task: { type: 'string', description: '这一步具体做什么，包含文件或范围线索' },
                done: { type: 'string', description: '可检查的完成标准' },
              },
            },
          },
        },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args, exec) {
        const agent = exec.agent
        const goal = String(args?.goal ?? '').trim()
        const rawSteps = Array.isArray(args?.steps) ? args.steps : []
        const incoming = rawSteps.slice(0, MAX_STEPS).map((step, index) => ({
          title: String(step?.title ?? '').trim() || `步骤 ${index + 1}`,
          task: String(step?.task ?? '').trim(),
          done: String(step?.done ?? '').trim(),
        })).filter((step) => step.task !== '')
        if (goal === '' || incoming.length === 0) {
          throw new Error('plan_write 需要非空的 goal 和至少一个带 task 的步骤')
        }
        const cwd = await ensureCwd(ctx, agent, exec.signal)
        const file = planFile(cwd, agent)
        // A rewrite after a discussion must not throw away finished work: the
        // merge keeps completed steps and their reports, and appends completed
        // steps this revision dropped instead of deleting them.
        const previous = readPlanFile(file)
        const merged = mergePlan(previous, { goal, steps: incoming })
        const plan = {
          ...merged.plan,
          session: merged.plan.session ?? shortSession(agent),
        }
        writePlanFile(file, plan)
        touchPlanIndex(agent, cwd, file)
        const lines = [
          `计划已写入 ${file}（第 ${merged.revision} 版，共 ${plan.steps.length} 步）：`,
          ...plan.steps.map((step) => `${step.n}. [${step.status}] ${step.title}`),
        ]
        if (merged.kept > 0) lines.push('', `已保留 ${merged.kept} 个已完成步骤的状态与报告，你不需要重写它们。`)
        if (merged.appended > 0) lines.push(`本次修订移除了 ${merged.appended} 个已完成步骤，它们连同报告已追加到计划末尾，不会丢失。`)
        lines.push('', '现在停下来：用不超过 8 行复述计划要点，等用户确认后再调用 step_run（除非用户已经明确说「开始」）。')
        return lines.join('\n')
      },
    },
    {
      name: 'step_run',
      description:
        '执行计划中的一步：把该步交给一个全新的子代理去做，等待它完成并返回报告，'
        + '同时返回下一步的切片。省略 step 即执行下一个未完成的步骤；重跑某步时传入 step。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          step: { type: 'integer', minimum: 1, description: '要执行的步骤号；省略则执行下一个未完成步骤' },
        },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args, exec) {
        return runStep(ctx, exec.agent, {
          step: Number.isFinite(args?.step) ? Number(args.step) : undefined,
          signal: exec.signal,
        })
      },
    },
  ]
}