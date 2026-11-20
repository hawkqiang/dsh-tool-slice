/**
 * tool-slice preset plugin: the model-facing side of the plan-act workflow —
 * `plan_write` writes the plan, `step_run` executes one step at a time, and
 * `plan_options` tells the planner which models and permissions it may assign.
 *
 * `plan_write` turns a task into a bounded Markdown plan that carries a model
 * and a permission profile per step; `step_run` hands one step at a time to a
 * fresh caller-delivered subagent, waits for its report, records the report in
 * the plan, and returns only the report plus the next step. The parent
 * conversation therefore grows by a few hundred tokens per step instead of
 * carrying the whole working context.
 *
 * The step machinery itself lives in `workflow.mjs`, because the `/slice`
 * command and the dock's buttons run the same operation.
 */
import {
  ensureCwd, planFile, readPlanFile, writePlanFile, touchPlanIndex, runStep, shortSession,
  watchStepChildren, modelChoices, toolNamesOf, readPlanDefaults, activityOf, sessionIdOf,
  mirrorPlanToTodos,
} from './workflow.mjs'
import {
  mergePlan, ACCESS_PROFILES, normalizeAccess, normalizeDeps, groupTools,
} from './core.mjs'

export const name = 'tool-slice-step-tools'
// Only core services are required: a profile without delegation or a
// working-directory provider must still be able to load the plan-act preset, so
// `subagents` and `workingDirectory` are resolved lazily at call time.
export const inject = ['tools', 'systemPrompt']

const MAX_STEPS = 40

/**
 * How much of the child's narration rides along inside the tool result.
 *
 * The conversation is where the human reads a subagent's work, so this is the
 * full trail rather than a teaser. The budget matches the preset's
 * `tool-result-pruner` threshold (4096 chars): past that the pruner compacts the
 * result for the model instead of the reader losing detail here.
 */
const TRAIL_LINES = 200
const TRAIL_CHARS = 4000

/**
 * The content blocks one `step_run` result shows: the model-facing report plus the
 * child's trail, which is what the human reads in the conversation.
 * @param {{text?: string, log?: string[], n?: number} | string | undefined} value
 * @returns {Array<{type: 'text', text: string}>}
 */
function contentOf(value) {
  const text = typeof value === 'string' ? value : String(value?.text ?? '')
  const log = typeof value === 'string' ? [] : (Array.isArray(value?.log) ? value.log : [])
  const blocks = [{ type: 'text', text }]
  if (log.length === 0) return blocks
  const trail = log.slice(-TRAIL_LINES).join('\n')
  const capped = trail.length > TRAIL_CHARS ? `${trail.slice(0, TRAIL_CHARS)}\n…（过程过长，已截断）` : trail
  const step = typeof value === 'string' ? '' : (Number(value?.n) > 0 ? `第 ${value.n} 步 · ` : '')
  blocks.push({ type: 'text', text: `\n## ${step}子代理全过程\n\`\`\`\n${capped}\n\`\`\`` })
  return blocks
}

/**
 * Which step a `step_run` report is about, read from its own first line.
 *
 * The report opens with `【第 N 步完成】` / `【第 N 步失败】` / `【第 N 步已取消】`,
 * so the tool can attach the right narration without a second return value.
 * @param {string} text
 * @returns {number}
 */
function stepOfReport(text) {
  const match = /第 (\d+)(?:\/\d+)? 步/.exec(String(text ?? ''))
  return match === null ? 0 : Number(match[1])
}

const SECTION = `## plan-act 工作法（必须遵守）

面对需要动手的任务，先规划（plan），再执行（act），一次只做一件小事：

1. 目标如果不明确，先用 ask_user_question 一次问 1–3 个关键问题，不要靠猜。
2. 动手拆解前，先调用 **plan_options**：它会告诉你此刻真正可用的模型（provider/模型id）与三档权限。
3. 用 plan_write 把目标拆成 3–8 个**很小的**独立步骤；每步只做一件事、几分钟能做完、能单独验证。**每一步都必须写**
   - title（短标题）、task（做什么）、done（可检查的完成标准）；
   - model：这一步交给哪个模型执行，从 plan_options 的清单里选（只读排查用小模型，改代码用编码模型）；留空表示继承父会话；
   - access：这一步给多少权限，只能填 只读 / 读写 / 全量（只读＝不能改文件不能跑命令；读写＝能改文件但不开终端不上网）；
   - dependsOn：这一步**必须等哪几步完成**，写步骤号数组；真正互不依赖才留空——并列的步骤可以被用户一键并行执行。
   计划会存成 Markdown 文件，用户能直接读。**不要用 write 工具手写计划文件**：只有 plan_write 写出来的计划才能被面板识别、确认和执行。
4. 计划写完后**停下来**：用不超过 8 行复述要点（每步一句话，带上模型、权限、依赖）。
   计划不会自动开跑：用户要在对话下面的「计划」面板里核对/调整每步的模型和工具，再点「确认计划」。
   确认之前调用 step_run 会被直接拒绝——所以不要催、不要试，也不要在复述里承诺“马上开始”。
5. 用户确认后才调用 step_run：它把「当前这一步」交给一个全新的子代理执行。子代理看不到当前对话，只看到这一步的目标、完成标准和此前各步的一句话结果，它会真正改文件、跑命令、做验证。
   step_run 用的是**计划里为这一步写好的**模型和权限；用户可以在面板里改，你负责按用户的修改重新 plan_write，不要试图绕过。
   **并行只在用户明确同意时**：用户说“可以并行/一起跑”，或面板上点了「并行执行就绪 N 步」，你才传 parallel: true 调用；否则一次一步。
6. 读 step_run 返回的报告和「计划状态」表，继续调用 step_run。这张表列出**每一步**的状态：待办 / 进行中 / 完成 / 失败 / 已取消，你可以据此判断该继续哪一步。不要自己重做子代理已完成的事，也不要一次把后面所有步骤写进对话。
   结果末尾还会附一段「子代理过程」（最多 10 条：工具调用、结果、它说的话），那是**给用户看的**，你只需要从中提取事实，不要复述它。
   用户说「自动跑完 / 顺次执行」，或面板点了「自动顺次跑完剩余 N 步」时：**连续调用 step_run，不要在步骤之间停下来问我**，直到没有可执行步骤或某步失败；某步失败就停下报告，不要跳过它。
7. 每轮只推进一步；某步报告不合格时，用同一个 step 号再调用一次 step_run 重跑。
8. **用户停止（已取消）之后**：不要自作主张继续。等用户选择「继续」（再调一次 step_run 重跑被取消的步骤）或「重新规划」（按新意见 plan_write）——两者都以用户的话为准。
9. 用户要改计划时，按他的意见重新调用 plan_write 写整份计划——已完成的步骤和报告会自动保留，只改没做的部分。改完会重新变成「未确认」，同样停下等用户再确认。
10. 全部完成后，用 5–10 行中文总结：改了什么、怎么验证的、还剩什么问题。

铁律：
- 计划唯一的事实来源是那个 Markdown 文件，不要在对话里复述或重写整份计划。
- 每个执行步骤都要小：目标单一、范围单一。一步太大就再拆成更小的步。
- 输出简短：不要长篇大思考，不要复述任务，不要复述工具返回的整段内容，只提取需要的几行。
- 读文件只读与当前步相关的片段，不要整篇通读；先查证再动手，不确定就用 read / grep 查，不要猜。`

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({ name: 'workflow:plan-act', order: 1500, text: SECTION }))
  // A step's own tool policy is applied to its child before that child's first
  // model request; the Host plugin's session mask cannot do this because the
  // child session id only exists after the reservation.
  ctx.effect(() => watchStepChildren(ctx))
  for (const definition of createStepTools(ctx)) {
    ctx.effect(() => ctx.tools.register(definition))
  }
}

/**
 * Build the model-facing tool definitions. Split out so the workflow can
 * be exercised with a fake context in tests.
 *
 * Order matters to callers that destructure: `plan_write` first, then
 * `step_run`, then the read-only `plan_options`.
 * @param {{workingDirectory?: object, subagents?: object}} ctx
 * @returns {Array<object>} plain ToolDefinition objects
 */
export function createStepTools(ctx) {
  return [
    {
      name: 'plan_write',
      description:
        '把任务拆解成分步计划，并写入 Markdown 文件。先用它拆解，再用 step_run 逐步执行；'
        + '写完就停下等用户确认（计划与每步的模型/权限由你提出，用户在面板里核对或调整）。'
        + '每步写 title（短标题）、task（做什么）、done（可检查的完成标准）、model（用哪个子模型）、access（只读/读写/全量）。',
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
                model: { type: 'string', description: '执行这一步的模型，格式 provider/模型id，取值见 plan_options；留空=继承父会话' },
                access: { type: 'string', enum: ['只读', '读写', '全量'], description: '这一步的权限：只读=不能改文件不能跑命令；读写=能改文件但无终端/网络；全量=不限制' },
                dependsOn: {
                  type: 'array',
                  items: { type: 'integer', minimum: 1 },
                  description: '这一步必须在哪些步骤号完成之后才能开始；互不依赖的步骤可以被并行执行。没有依赖就省略',
                },
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
        const defaults = readPlanDefaults()
        const incoming = rawSteps.slice(0, MAX_STEPS).map((step, index) => {
          const access = normalizeAccess(step?.access)
          const hidden = Array.isArray(step?.hidden) ? step.hidden : []
          return {
            title: String(step?.title ?? '').trim() || `步骤 ${index + 1}`,
            task: String(step?.task ?? '').trim(),
            done: String(step?.done ?? '').trim(),
            model: String(step?.model ?? '').trim(),
            access,
            // A step the planner left unconstrained takes the profile default, so
            // the plan file records the policy that will really run.
            ...(access === '' && hidden.length === 0 && defaults.access !== ''
              ? { access: defaults.access }
              : {}),
            ...(access === '' && hidden.length === 0 && defaults.access === '' && defaults.hidden.length > 0
              ? { hidden: defaults.hidden }
              : {}),
            dependsOn: normalizeDeps(step?.dependsOn, index + 1),
          }
        }).filter((step) => step.task !== '')
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
        // The conversation's 任务 card is driven by the session's todo list, so a
        // freshly written plan shows up there as an all-pending checklist.
        mirrorPlanToTodos(agent, plan)
        const known = new Set((await modelChoices(ctx)).map((choice) => choice.value))
        const lines = [
          `计划已写入 ${file}（第 ${merged.revision} 版，共 ${plan.steps.length} 步）：`,
        ]
        for (const step of plan.steps) {
          const assigned = [
            `模型 ${step.model === '' ? '继承父会话' : step.model}`,
            `权限 ${step.access === '' ? '未指定（全量）' : step.access}`,
          ].join(' · ')
          const deps = Array.isArray(step.dependsOn) && step.dependsOn.length > 0
            ? ` · 依赖 ${step.dependsOn.join(', ')}`
            : ''
          lines.push(`${step.n}. [${step.status}] ${step.title} — ${assigned}${deps}`)
        }
        // A model id that no provider serves would only fail at run time, when
        // the user has already confirmed; say so now instead.
        const unknown = plan.steps
          .map((step) => step.model)
          .filter((model) => model !== '' && known.size > 0 && !known.has(model))
        if (unknown.length > 0) {
          lines.push('', `注意：这些模型不在当前可用清单里，执行前请改成可用值：${[...new Set(unknown)].join(', ')}`)
        }
        if (merged.kept > 0) lines.push('', `已保留 ${merged.kept} 个已完成步骤的状态与报告，你不需要重写它们。`)
        if (merged.appended > 0) lines.push(`本次修订移除了 ${merged.appended} 个已完成步骤，它们连同报告已追加到计划末尾，不会丢失。`)
        lines.push('', '现在停下来：用不超过 8 行复述计划要点（每步带上模型与权限），等用户确认（面板点「确认计划」或 /slice approve）。'
          + '确认之前 step_run 会被拒绝。')
        return lines.join('\n')
      },
    },
    {
      name: 'step_run',
      description:
        '执行计划中的一步：把该步交给一个全新的子代理去做，等待它完成并返回报告。'
        + '只有用户确认过这份计划（「确认计划」或 /slice approve）才允许执行；否则会直接报错。'
        + '该步用哪个模型、能调哪些工具由计划里为该步写好的 model / access 决定，本工具不接受这些参数。'
        + '省略 step 即执行下一个未完成的步骤；重跑某步时传入 step。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          step: { type: 'integer', minimum: 1, description: '要执行的步骤号；省略则执行下一个未完成步骤' },
          parallel: {
            type: 'boolean',
            description: '只有用户明确同意并行时才传 true：同时启动所有依赖已满足的步骤。默认顺序执行。',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: {
            text: { type: 'string', description: '精简报告：状态、报告正文、计划状态表' },
            n: { type: 'integer', description: '这一步的步骤号' },
            log: { type: 'array', items: { type: 'string' }, description: '子代理的过程行，用于对话里展示' },
          },
        },
        // The Web conversation renders this content; it is what the human reads.
        render: (_args, value) => contentOf(value),
        // `meta` is presentation-only: the model gets `text`, the transcript card
        // gets the child's whole trail. That is the whole point of keeping this
        // log out of the parent's context.
        presentationMeta: (_args, value) => ({
          n: Number(value?.n ?? 0),
          log: (Array.isArray(value?.log) ? value.log : []).join('\n').slice(-6000),
        }),
      },
      // The Web conversation renders a tool result's content blocks, so the child's
      // trail has to travel in `content` to be visible in the big dialog at all.
      // It is capped hard: the parent context grows by a few lines per step, never
      // by the child's whole history. `presentResult` is kept for bridges that do
      // consume card views.
      projectContent: (_exec, result) => contentOf(result?.value),
      // The big conversation shows what the child actually did, step by step.
      presentResult: (_args, result) => {
        const meta = result?.meta ?? {}
        const log = typeof meta?.log === 'string' ? meta.log : ''
        const title = `第 ${Number(meta?.n ?? 0) || '?'} 步 · 子代理全过程`
        if (log === '') return { card: 'generic', title, content: result?.content ?? [] }
        return { card: 'generic', title, content: [{ type: 'text', text: log }] }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: Number.isFinite(args?.step) ? `执行第 ${Number(args.step)} 步` : '执行下一步',
        kind: 'other',
      }),
      async execute(args, exec) {
        const agent = exec.agent
        const text = await runStep(ctx, agent, {
          step: Number.isFinite(args?.step) ? Number(args.step) : undefined,
          parallel: args?.parallel === true,
          signal: exec.signal,
        })
        // Read the trail after the run settled: `activityOf` holds the last 40
        // lines of every step of this session.
        const activity = activityOf(sessionIdOf(agent))
        const stepNumber = stepOfReport(text)
        return {
          text,
          n: stepNumber,
          log: activity[String(stepNumber)] ?? [],
        }
      },
    },
    {
      name: 'plan_options',
      description:
        '列出此刻真正可用的子模型（provider/模型id）和三档权限说明，供 plan_write 为每一步指定 model 与 access。'
        + '规划前先调用一次。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(_args, exec) {
        const models = await modelChoices(ctx)
        const tools = toolNamesOf(exec.agent)
        const groups = groupTools(tools.map((name) => ({ name, tokens: 0, summary: '' })))
        const lines = ['## 可用模型（为每步的 model 字段选一个；留空=继承父会话）']
        if (models.length === 0) {
          lines.push('- （查不到模型清单：这一步可以留空，执行时会继承父会话）')
        } else {
          for (const choice of models) lines.push(`- ${choice.value}  —— ${choice.label}`)
        }
        lines.push('', '## 权限档位（为每步的 access 字段选一个）')
        for (const profile of ACCESS_PROFILES) lines.push(`- ${profile.id}：${profile.note}`)
        lines.push('', '## 依赖与并行（为每步的 dependsOn 字段选）')
        lines.push('- 这一步要等哪几步完成，就写那几个步骤号；互不依赖的步骤可以由用户一键并行执行。')
        lines.push('- 并行只在用户明确同意后才发生（面板「并行执行就绪 N 步」或带 parallel: true 调用 step_run）。')
        lines.push('', '## 当前预设挂载的工具（只读排查时用「只读」即可，不必逐个点名）')
        if (groups.length === 0) {
          lines.push('- （工具清单不可读）')
        } else {
          for (const group of groups) {
            lines.push(`- ${group.label}（${group.tools.length}）：${group.tools.map((tool) => tool.name).join('、')}`)
          }
        }
        return lines.join('\n')
      },
    },
  ]
}