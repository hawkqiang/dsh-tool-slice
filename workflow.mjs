/**
 * The slice workflow shared by the model-facing tools (this bundle's preset
 * plugin) and the human-facing `/slice` command plus the plan route (the Host
 * plugin). One implementation means the dock button, the slash command, and
 * `step_run` always agree on the plan file, the step it runs, and the text the
 * caller receives.
 *
 * Node-side only: pure plan formatting lives in `core.mjs`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  STATUS, renderPlan, parsePlan, pickStep, progressLine, planView, sliceForStep, clampReport,
} from './core.mjs'

export const REPORT_CHARS = 1400
export const RECORD_CHARS = 2000
const INDEX_LIMIT = 40

/**
 * Locate the profile's plan index. The Host plugin serves the dock from the
 * same file this writes, so both compute it with one function.
 * @returns {string}
 */
export function planIndexPath() {
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile === 'string' && profile !== '') return path.join(profile, 'tool-slice-plans.json')
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'tool-slice-plans.json')
}

/**
 * @returns {{version: number, sessions: Record<string, {file: string, cwd: string, updatedAt: string}>}}
 */
export function readPlanIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(planIndexPath(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && parsed.sessions !== null && typeof parsed.sessions === 'object') {
      return { version: 1, sessions: parsed.sessions }
    }
  } catch {
    /* a missing or half-written index simply means "no known plan" */
  }
  return { version: 1, sessions: {} }
}

/**
 * Record where one session's plan lives, so the dock can read it without an
 * Agent. Best effort: a failed write never fails the step.
 * @param {object} agent
 * @param {string} cwd
 * @param {string} file
 */
export function touchPlanIndex(agent, cwd, file) {
  try {
    const index = readPlanIndex()
    const merged = mergeSessions(index, sessionIdOf(agent), {
      file,
      cwd,
      updatedAt: new Date().toISOString(),
    })
    const target = planIndexPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  } catch {
    /* the dock can also fall back to "no plan" */
  }
}

/**
 * @param {{sessions: Record<string, object>}} index
 * @param {string} sessionId
 * @param {{file: string, cwd: string, updatedAt: string}} entry
 * @returns {{version: number, sessions: Record<string, object>}}
 */
function mergeSessions(index, sessionId, entry) {
  const sessions = {}
  if (sessionId !== '') sessions[sessionId] = entry
  const rest = Object.entries(index.sessions ?? {})
    .filter(([name, value]) => name !== sessionId && value !== null && typeof value === 'object')
    .sort((a, b) => String(b[1].updatedAt ?? '').localeCompare(String(a[1].updatedAt ?? '')))
  for (const [name, value] of rest) {
    if (Object.keys(sessions).length >= INDEX_LIMIT) break
    sessions[name] = value
  }
  return { version: 1, sessions }
}

/**
 * The plan file for one Agent: one file per session under the working
 * directory, so a second session never overwrites the first one's plan.
 * @param {string} cwd
 * @param {object} agent
 * @returns {string}
 */
export function planFile(cwd, agent) {
  return path.join(cwd, '.dsh', 'plans', `plan-${shortSession(agent)}.md`)
}

/**
 * @param {object} agent
 * @returns {string}
 */
export function shortSession(agent) {
  const id = String(agent?.session?.id ?? 'default')
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(-8) || 'default'
}

/**
 * @param {object} agent
 * @returns {string}
 */
export function sessionIdOf(agent) {
  return String(agent?.session?.id ?? '')
}

/**
 * @param {string} file
 * @param {{goal: string, session?: string, createdAt?: string, steps: object[]}} plan
 */
export function writePlanFile(file, plan) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlan(plan), 'utf8')
}

/**
 * @param {string} file
 * @returns {{goal: string, steps: object[]} | undefined}
 */
export function readPlanFile(file) {
  try {
    const parsed = parsePlan(fs.readFileSync(file, 'utf8'))
    return parsed.steps.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Read an optional service without requiring it at activation time.
 * @param {object} ctx
 * @param {string} service
 * @returns {any}
 */
export function serviceOf(ctx, service) {
  if (typeof ctx.get === 'function') {
    const found = ctx.get(service)
    if (found !== undefined) return found
  }
  return ctx[service]
}

/**
 * The Agent's current directory, falling back to the process directory when
 * the profile has no working-directory provider.
 * @param {object} ctx
 * @param {object} agent
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<string>}
 */
export async function ensureCwd(ctx, agent, signal) {
  const workingDirectory = serviceOf(ctx, 'workingDirectory')
  if (workingDirectory !== undefined && typeof workingDirectory.ensure === 'function') {
    return workingDirectory.ensure(agent, signal)
  }
  let projected
  try {
    projected = agent?.session?.projections?.values?.workingDirectory
  } catch {
    projected = undefined
  }
  return typeof projected === 'string' && projected !== '' ? projected : process.cwd()
}

/**
 * The delegation service, reported as a failure message when the composition
 * has none instead of failing the whole preset at activation.
 * @param {object} ctx
 * @returns {any}
 */
export function subagentsOf(ctx) {
  const subagents = serviceOf(ctx, 'subagents')
  if (subagents === undefined || typeof subagents.startActivation !== 'function') {
    throw new Error('这个预设没有启用子代理委派，无法逐步执行；可以自己完成这一步，或换用带委派的预设')
  }
  return subagents
}

/**
 * Run the plan's next (or one addressed) step in a fresh caller-delivered
 * subagent, record the report, and return the text both callers show.
 * @param {object} ctx
 * @param {object} agent
 * @param {{step?: number, signal?: AbortSignal}} options
 * @returns {Promise<string>}
 */
export async function runStep(ctx, agent, options = {}) {
  const cwd = await ensureCwd(ctx, agent, options.signal)
  const file = planFile(cwd, agent)
  const plan = readPlanFile(file)
  if (plan === undefined) throw new Error(`还没有计划文件（${file}）：先调用 plan_write 拆解任务，或用「建计划」按钮`)

  const picked = pickStep(plan, Number.isFinite(options.step) ? Number(options.step) : undefined)
  if (picked.step === undefined) {
    touchPlanIndex(agent, cwd, file)
    return `无需执行：${picked.error}。计划文件：${file}`
  }

  const step = picked.step
  step.status = STATUS.doing
  writePlanFile(file, plan)
  touchPlanIndex(agent, cwd, file)

  let report
  try {
    const activation = await subagentsOf(ctx).startActivation({
      provider: 'spawn',
      label: `step ${step.n}`,
      prompt: [{ type: 'text', text: workerPrompt({ goal: plan.goal, file, cwd, step, steps: plan.steps }) }],
      parent: agent,
      signal: options.signal,
      delivery: 'caller',
    })
    const result = await activation.result
    const output = textOf(result?.output)
    if (result?.stopReason !== 'completed' || output === '') {
      step.status = STATUS.failed
      step.record = `未完成（${result?.stopReason ?? 'unknown'}）：${String(result?.diagnostic ?? output ?? '子代理没有输出').slice(0, 800)}`
      writePlanFile(file, plan)
      touchPlanIndex(agent, cwd, file)
      return [
        `【第 ${step.n} 步失败】${step.title}`,
        `原因：${result?.stopReason ?? 'unknown'}${result?.diagnostic ? ` — ${result.diagnostic}` : ''}`,
        step.record,
        '',
        '可以补足信息后重跑这一步，或先用 plan_write 修订计划。',
      ].join('\n')
    }
    report = clampReport(output, REPORT_CHARS)
    step.status = STATUS.done
    step.record = clampReport(output, RECORD_CHARS)
  } catch (error) {
    step.status = STATUS.failed
    step.record = `子代理启动或执行失败：${messageOf(error)}`
    writePlanFile(file, plan)
    touchPlanIndex(agent, cwd, file)
    return [
      `【第 ${step.n} 步失败】${step.title}`,
      step.record,
      '',
      '这通常是子代理无法启动（例如委派深度已达上限）。可以直接自己完成这一步，或修好原因后再重跑。',
    ].join('\n')
  }
  writePlanFile(file, plan)
  touchPlanIndex(agent, cwd, file)

  const next = plan.steps.find((candidate) => candidate.status !== STATUS.done && candidate.status !== STATUS.failed)
  const head = [`【第 ${step.n}/${plan.steps.length} 步完成】${step.title}`, '子代理报告：', report, '', `进度：${progressLine(plan)}`]
  if (next === undefined) {
    head.push('', `全部 ${plan.steps.length} 步已完成。计划文件：${file}`)
    head.push('现在用 5–10 行中文向用户总结：改了什么、怎么验证的、还剩什么问题。')
  } else {
    head.push('', `【下一步 · 第 ${next.n} 步】${next.title}`)
    head.push(`做什么：${next.task}`)
    if (next.done !== '') head.push(`完成标准：${next.done}`)
    head.push(`→ 继续调用 step_run（省略参数即执行第 ${next.n} 步）。`)
  }
  return head.join('\n')
}

/**
 * One-line status for `/slice show` and for the dock's empty state.
 * @param {object} agent
 * @param {object} ctx
 * @returns {Promise<string>}
 */
export async function planStatusText(ctx, agent) {
  const cwd = await ensureCwd(ctx, agent, undefined)
  const file = planFile(cwd, agent)
  const plan = readPlanFile(file)
  if (plan === undefined) {
    return [`还没有计划：${file}`, '用「建计划」按钮或 /slice plan <目标> 让模型先拆解，再逐步执行。'].join('\n')
  }
  touchPlanIndex(agent, cwd, file)
  const view = planView(plan, { file })
  const lines = [`# ${view.goal || '（无目标）'}`, `进度：${view.progress}`, `文件：${file}`]
  if (view.current !== null) {
    lines.push(`下一步：第 ${view.current.n} 步 ${view.current.title}`)
    if (view.current.task !== '') lines.push(`做什么：${view.current.task}`)
  }
  for (const step of view.steps) {
    lines.push(`${step.n}. [${step.status}] ${step.title}`)
  }
  return lines.join('\n')
}

/**
 * The message `/slice plan` hands to the model. A plan is a conversation, so
 * this opens with clarification and only then allows a decomposition; it
 * explicitly forbids starting work in the same turn.
 * @param {string} goal
 * @returns {string}
 */
export function planRequestPrompt(goal) {
  return [
    `我想做这件事：${goal}`,
    '',
    '先不要动手，我们先把计划讨论清楚。请按这个顺序来：',
    '1. 如果上面的目标还有歧义（范围、边界、验收标准、要不要动某些文件），先用 ask_user_question 问我 1–3 个最关键的问题，一次问完。',
    '2. 我问完答完，你再用 plan_write 把任务拆成 3–8 个独立小步（每步写清做什么与完成标准）。',
    '3. 计划写完后**停下来**：用不超过 8 行复述计划要点（每步一句话），等我确认。不要调用 step_run，也不要开始改代码。',
    '',
    '我确认后会说「开始」，或者自己点面板上的「执行下一步」。',
  ].join('\n')
}

/**
 * The message `/slice revise` hands to the model after the user edits the plan
 * in discussion. Re-planning preserves finished steps automatically.
 * @param {string} feedback
 * @param {string} [goal]
 * @returns {string}
 */
export function revisePrompt(feedback, goal) {
  return [
    goal !== undefined && goal !== '' ? `当前计划的目标：${goal}` : '当前计划已经在文件里。',
    '',
    `我对计划的修改意见：${feedback}`,
    '',
    '请用 plan_write 重写整份计划（保留原来的步数编号习惯），然后用不超过 6 行说明改了什么。'
    + '已完成的步骤和它们的报告会自动保留，你不需要重写那部分。',
    '',
    '仍然不要开始执行：写完计划就停下，等我确认。',
  ].join('\n')
}

/**
 * @param {{goal: string, file: string, cwd: string, step: object, steps: object[]}} input
 * @returns {string}
 */
export function workerPrompt(input) {
  const { goal, file, cwd, step, steps } = input
  const slice = sliceForStep({ goal, steps }, step, { maxChars: 2400, history: 3 })
  return [
    '你是执行子代理，只负责下面这一步，不要重新规划整个任务，也不要改计划文件。',
    '',
    `工作目录：${cwd}`,
    `计划文件：${file}（由主代理维护，只读）`,
    '',
    slice,
    '',
    '要求：',
    '- 直接动手：读必要的文件、改代码、跑命令验证，不要只给建议。',
    '- 只改与本步相关的文件，改动尽量小，沿用仓库已有写法。',
    '- 不要再调用 plan_write 或 step_run：工具表里它们只是随预设一起挂载，你已经是最底层的执行者。',
    '- 不要询问；确实无法继续时，说明卡点和需要什么信息。',
    '- 最后输出不超过 12 行：做了什么 / 改了哪些文件 / 验证结果 / 遗留问题。',
  ].join('\n')
}

export function textOf(output) {
  if (!Array.isArray(output)) return ''
  return output
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n')
    .trim()
}

export function messageOf(error) {
  return String(error?.message ?? error).slice(0, 300)
}