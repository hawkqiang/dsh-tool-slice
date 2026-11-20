/**
 * The plan-act workflow shared by the model-facing tools (this bundle's preset
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
import { randomUUID } from 'node:crypto'
import {
  STATUS, renderPlan, parsePlan, pickStep, nextStep, progressLine, planView, sliceForStep, clampReport,
  isApproved, markApproved, modelLabel, accessLabel, accessHidden, normalizeNames, normalizeAccess, patchStep,
  readySteps, statusTable,
} from './core.mjs'

export const REPORT_CHARS = 1400
export const RECORD_CHARS = 2000
const INDEX_LIMIT = 40

/**
 * Per-step tool policies, keyed by the child Session id reserved before the
 * child is created. A child's first model request needs the restriction
 * already in place, and the only supported moment before it is `agent/created`
 * — which is why the id is reserved up front rather than read from the result.
 */
const stepToolPolicies = new Map()

/**
 * Remember which tools one step's child may not call.
 * @param {string} childId reserved child Session id
 * @param {string[]} hidden tool names to deny
 */
export function reserveStepTools(childId, hidden) {
  const names = normalizeNames(hidden)
  if (names.length === 0) return
  stepToolPolicies.set(childId, names)
  // A lost activation must not leave a policy behind for a later session id.
  if (stepToolPolicies.size > 200) {
    const oldest = stepToolPolicies.keys().next()
    if (!oldest.done) stepToolPolicies.delete(oldest.value)
  }
}

/**
 * Drop a reservation once its child exists (or never will).
 * @param {string} childId
 */
export function releaseStepTools(childId) {
  stepToolPolicies.delete(childId)
}

/**
 * Apply a reserved policy to the child before its first model request.
 *
 * Registered by the preset plugin; `tools.restrict` is scoped to the Agent that
 * calls it, so the child's own context must do the call and the restriction is
 * released with that Agent.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {unknown} the listener disposer
 */
/**
 * Live activity of running steps: `parentSessionId` → `step number` → lines.
 *
 * The child is a real Session, so its committed events are the honest answer to
 * "what is step 3 doing right now": tool calls, tool results, and the assistant
 * text that follows them. The panel polls {@link activityOf} while a step runs.
 */
const stepActivity = new Map()
/** Enough lines to keep a long step readable; the conversation result is capped by characters. */
const MAX_ACTIVITY_LINES = 200

/**
 * Cost of each step: token usage summed from the child's own assistant messages
 * plus the wall-clock span, so the panel can show `tok/s` and elapsed time.
 * Shape: parentSessionId → step → {startedMs, endedMs, input, output, total, calls}.
 */
const stepStats = new Map()

/** Start (or reset) one step's counters. */
function startStepStats(parentSessionId, step) {
  let session = stepStats.get(String(parentSessionId))
  if (session === undefined) {
    session = new Map()
    stepStats.set(String(parentSessionId), session)
  }
  session.set(Number(step), {
    startedMs: Date.now(), endedMs: 0, input: 0, output: 0, total: 0, calls: 0,
  })
}

/** Fold one assistant message's usage into its step's counters. */
function addStepUsage(parentSessionId, step, usage) {
  if (usage === undefined || usage === null) return
  let session = stepStats.get(String(parentSessionId))
  if (session === undefined) {
    session = new Map()
    stepStats.set(String(parentSessionId), session)
  }
  let entry = session.get(Number(step))
  // A step started before this feature existed (or observed outside a batch)
  // still gets counted instead of silently dropping its tokens.
  if (entry === undefined) {
    entry = { startedMs: Date.now(), endedMs: 0, input: 0, output: 0, total: 0, calls: 0 }
    session.set(Number(step), entry)
  }
  entry.calls += 1
  entry.input += Number(usage.inputTokens ?? 0) || 0
  entry.output += Number(usage.outputTokens ?? 0) || 0
  entry.total += Number(usage.totalTokens ?? (Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0))) || 0
}

/** Close one step's window so the panel stops counting up. */
function endStepStats(parentSessionId, step) {
  const entry = stepStats.get(String(parentSessionId))?.get(Number(step))
  if (entry !== undefined && entry.endedMs === 0) entry.endedMs = Date.now()
}

/**
 * Per-step cost, ready to render: elapsed time and output tokens per second.
 * @param {string} parentSessionId
 * @returns {Record<string, {input: number, output: number, total: number, calls: number, ms: number, tps: number}>}
 */
export function stepStatsOf(parentSessionId) {
  const session = stepStats.get(String(parentSessionId))
  if (session === undefined) return {}
  const now = Date.now()
  const out = {}
  for (const [step, entry] of session.entries()) {
    const ms = Math.max(0, (entry.endedMs === 0 ? now : entry.endedMs) - entry.startedMs)
    const seconds = ms / 1000
    out[String(step)] = {
      input: entry.input,
      output: entry.output,
      total: entry.total,
      calls: entry.calls,
      ms,
      tps: seconds > 0 ? Math.round((entry.output / seconds) * 10) / 10 : 0,
    }
  }
  return out
}

/** child session id → which parent step it belongs to. */
const childActivityTarget = new Map()

/** childId (reserved before creation) → its parent step. */
const pendingActivityTarget = new Map()

/**
 * Remember which parent step a soon-to-exist child belongs to.
 * @param {string} childId reserved child id passed to `startActivation`
 * @param {{parent: string, step: number}} target
 */
export function reserveChildActivity(childId, target) {
  pendingActivityTarget.set(String(childId), { parent: String(target.parent), step: Number(target.step) })
}

/**
 * Drop one step's activity so a retry starts from a clean log.
 * @param {string} parentSessionId
 * @param {number} step
 */
export function resetStepActivity(parentSessionId, step) {
  const session = stepActivity.get(String(parentSessionId))
  if (session !== undefined) session.delete(Number(step))
}

/**
 * The lines each step of one Session produced, newest last.
 * @param {string} parentSessionId
 * @returns {Record<string, string[]>} step number → lines
 */
export function activityOf(parentSessionId) {
  const session = stepActivity.get(String(parentSessionId))
  if (session === undefined) return {}
  return Object.fromEntries([...session.entries()].map(([step, lines]) => [String(step), [...lines]]))
}

/**
 * @param {{parent: string, step: number}} target
 * @param {string[]} lines
 */
function pushActivity(target, lines) {
  if (lines.length === 0) return
  let session = stepActivity.get(target.parent)
  if (session === undefined) {
    session = new Map()
    stepActivity.set(target.parent, session)
  }
  const current = session.get(target.step) ?? []
  current.push(...lines)
  // Keep the tail: the panel shows the last few lines, and a long step must not
  // grow the Host's memory without bound.
  session.set(target.step, current.slice(-MAX_ACTIVITY_LINES))
}

/**
 * Read the text blocks of a message content array.
 * @param {unknown} content
 * @returns {string}
 */
function blocksText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block === 'string') { parts.push(block); continue }
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * One line per session event, or nothing when the event says little.
 * @param {object} event a SessionEvent
 * @returns {string[]}
 */
function describeEvent(event) {
  const type = String(event?.type ?? '')
  const data = event?.data ?? {}
  if (type === 'tool/call') {
    return [`🔧 ${String(data.name ?? 'tool')}(${clampReport(String(data.arguments ?? ''), 110)})`]
  }
  if (type === 'tool/result') {
    const text = blocksText(data.message?.content)
    const bad = data.error !== undefined || data.message?.isError === true
    return [`${bad ? '✗' : '✓'} ${clampReport(text, 150)}`]
  }
  if (type === 'assistant/message') {
    const text = blocksText(data.message?.content)
    return text === '' ? [] : [`💬 ${clampReport(text, 200)}`]
  }
  if (type === 'turn/end') return [`— 结束：${String(data.reason?.kind ?? 'unknown')}`]
  return []
}

/**
 * Attach a step's tool policy to its child Agent the moment it is created, and
 * feed the child's committed events into that step's live activity log.
 * @param {object} ctx
 * @returns {() => void} disposer
 */
export function watchStepChildren(ctx) {
  const disposers = []
  disposers.push(ctx.on('agent/created', ({ agent }) => {
    const id = String(agent?.session?.id ?? '')
    const policy = stepToolPolicies.get(id)
    const activity = pendingActivityTarget.get(id) ?? childActivityTarget.get(id)
    if (policy === undefined && activity === undefined) return
    if (policy !== undefined) stepToolPolicies.delete(id)
    if (activity !== undefined) {
      pendingActivityTarget.delete(id)
      childActivityTarget.set(id, activity)
      pushActivity(activity, ['— 子代理已启动'])
    }
    if (policy === undefined) return
    const hidden = policy
    try {
      const tools = agent?.ctx?.tools
      if (tools === undefined || typeof tools.restrict !== 'function') return
      // A deny name this child cannot see fails the whole filter, so narrow the
      // list to the tools it actually mounted first.
      let narrowed = hidden
      if (typeof tools.definitions === 'function') {
        try {
          const visible = new Set(tools.definitions(agent).map((definition) => definition.name))
          narrowed = hidden.filter((name) => visible.has(name))
        } catch {
          narrowed = hidden
        }
      }
      if (narrowed.length === 0) return
      const dispose = tools.restrict({ deny: narrowed })
      agent.ctx.effect(() => dispose)
    } catch {
      /* a policy that cannot apply must not fail the child's creation */
    }
  }, { global: true }))
  // Every committed event of a child Session feeds its step's log. The lookup is
  // O(1) and non-matching sessions return immediately, so the global listener is
  // cheap even with many conversations open.
  disposers.push(ctx.on('session/event', (session, event) => {
    const id = String(session?.id ?? '')
    const target = childActivityTarget.get(id)
    if (target === undefined) return
    try {
      pushActivity(target, describeEvent(event))
      // Token usage lives on the assistant message that closed the request.
      if (event?.type === 'assistant/message') addStepUsage(target.parent, target.step, event.data?.usage)
    } catch {
      /* narration must never break the child's own append */
    }
  }, { global: true }))
  return () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        /* a stale disposer is harmless */
      }
    }
  }
}

/**
 * Split `provider/model` into an Agent route.
 * @param {string} value
 * @returns {{provider: string, model: string} | undefined}
 */
export function parseRoute(value) {
  const text = String(value ?? '').trim()
  const slash = text.indexOf('/')
  if (slash <= 0 || slash === text.length - 1) return undefined
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
}

/**
 * Reject a route the LLM runtime does not serve before a child is created.
 * @param {object} ctx
 * @param {{provider: string, model: string}} route
 * @param {AbortSignal | undefined} signal
 */
async function assertRoute(ctx, route, signal) {
  const llm = serviceOf(ctx, 'llm')
  if (llm === undefined || typeof llm.resolveCallConfig !== 'function') return
  try {
    await llm.resolveCallConfig({ provider: route.provider, model: route.model }, signal)
  } catch (error) {
    throw new Error(`这一步的模型「${route.provider}/${route.model}」不可用：${messageOf(error)}`)
  }
}

/**
 * The routes the user already curated for delegation, if that setting exists.
 *
 * Reusing the subagent model-selection list means the planner proposes from the
 * same short list the human configured, instead of every model the LLM runtime
 * happens to serve.
 * @param {object} ctx
 * @returns {Array<{provider: string, model: string}> | undefined}
 */
export function allowedModelRoutes(ctx) {
  try {
    const service = serviceOf(ctx, 'subagentModelSelection')
    const list = service?.config?.allowedModels?.get?.()
    if (!Array.isArray(list) || list.length === 0) return undefined
    const routes = []
    for (const entry of list) {
      if (typeof entry?.provider !== 'string' || typeof entry?.model !== 'string') continue
      routes.push({ provider: entry.provider, model: entry.model })
    }
    return routes.length > 0 ? routes : undefined
  } catch {
    return undefined
  }
}

/**
 * `provider/model` choices with readable labels, for the planner and the panel.
 * @param {object} ctx
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function modelChoices(ctx) {
  const routes = await listModelRoutes(ctx)
  const allowed = allowedModelRoutes(ctx)
  const labelOf = (provider, model) => {
    const route = routes.find((candidate) => candidate.provider === provider)
    const named = route?.models.find((candidate) => candidate.id === model)
    return `${route?.name ?? provider} / ${named?.name ?? model}`
  }
  const source = allowed ?? routes.flatMap((route) => route.models.map((model) => ({ provider: route.provider, model: model.id })))
  return source.map((route) => ({ value: `${route.provider}/${route.model}`, label: labelOf(route.provider, route.model) }))
}

/**
 * The tools one Agent can see, as names. Used to turn a step's permission
 * profile into a concrete deny list and to size the panel's tool groups.
 * @param {object} agent
 * @returns {string[]}
 */
export function toolNamesOf(agent) {
  try {
    const definitions = agent?.ctx?.tools?.definitions?.(agent)
    if (!Array.isArray(definitions)) return []
    return definitions.map((definition) => String(definition?.name ?? '')).filter((name) => name !== '')
  } catch {
    return []
  }
}

/**
 * The deny list one step runs with.
 *
 * A granular list (written by the panel) wins; otherwise the planner's declared
 * permission profile is expanded against the tools this preset actually mounts,
 * so the profile never names a tool the child does not have.
 * @param {{access?: string, hidden?: string[]}} step
 * @param {object} agent the parent Agent, whose preset the child inherits
 * @returns {string[]}
 */
export function stepDenyList(step, agent) {
  const explicit = normalizeNames(step?.hidden)
  if (explicit.length > 0) return explicit
  return accessHidden(step?.access, toolNamesOf(agent))
}

/** Model routes offered in the panel, cached because adapters may be slow. */
let modelCache = { at: 0, routes: [] }

/**
 * Enumerate the providers and models this deployment can actually run.
 * @param {object} ctx
 * @param {number} [ttlMs]
 * @returns {Promise<Array<{provider: string, name: string, models: Array<{id: string, name: string}>}>>}
 */
export async function listModelRoutes(ctx, ttlMs = 60_000) {
  if (Date.now() - modelCache.at < ttlMs && modelCache.routes.length > 0) return modelCache.routes
  const llm = serviceOf(ctx, 'llm')
  if (llm === undefined || typeof llm.listProviders !== 'function') return []
  const routes = []
  for (const provider of llm.listProviders() ?? []) {
    let models = []
    try {
      models = typeof llm.listModels === 'function' ? await llm.listModels(provider.id) : []
    } catch {
      models = []
    }
    routes.push({
      provider: provider.id,
      name: String(provider.name ?? provider.id),
      models: (models ?? []).map((model) => ({ id: String(model.id), name: String(model.name ?? model.id) })),
    })
  }
  modelCache = { at: Date.now(), routes }
  return routes
}

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
 * The profile state file the panel writes its switches and plan defaults into.
 * @returns {string}
 */
export function sliceStatePath() {
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile === 'string' && profile !== '') return path.join(profile, 'tool-slice.json')
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'tool-slice.json')
}

/**
 * The default permission a new step starts from, as the panel saved it.
 *
 * Read on demand (not cached): the user can change it between two steps, and the
 * next planned step should pick the new value up.
 * @returns {{access: string, hidden: string[]}}
 */
export function readPlanDefaults() {
  try {
    const parsed = JSON.parse(fs.readFileSync(sliceStatePath(), 'utf8'))
    const access = normalizeAccess(parsed?.planDefaults?.access)
    const hidden = access === '' ? normalizeNames(parsed?.planDefaults?.hidden) : []
    return { access, hidden }
  } catch {
    return { access: '', hidden: [] }
  }
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
  recordPlanLocation(sessionIdOf(agent), cwd, file)
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
 * A usable cancellation signal.
 *
 * The delegation manager dereferences the signal unconditionally
 * (`signal.throwIfAborted()`), so a caller with no cancellation to offer — the
 * panel's "执行下一步" click, or `/slice next` — must still supply one. A fresh
 * never-aborted signal per call is correct and cannot accumulate listeners on a
 * shared instance.
 * @param {AbortSignal | undefined} signal
 * @returns {AbortSignal}
 */
function cancellationSignal(signal) {
  return signal ?? new AbortController().signal
}

/**
 * Plan runs currently in flight, keyed by Session.
 *
 * Holding the controller here is what makes a plan stop different from a turn
 * stop: aborting it cancels every running child of that Session while the
 * model's turn keeps going, so it can report the cancellation and stay usable.
 */
const activeRuns = new Map()

/**
 * Whether a Session has a plan run in flight.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isRunning(sessionId) {
  return activeRuns.has(String(sessionId))
}

/**
 * Cancel every running step of one Session.
 * @param {string} sessionId
 * @returns {boolean} whether anything was running
 */
export function stopSession(sessionId) {
  const running = activeRuns.get(String(sessionId))
  if (running === undefined) return false
  running.controller.abort()
  return true
}

/**
 * Run one or more ready steps in fresh caller-delivered subagents, record each
 * report, and return the text both callers show.
 *
 * The batch is the unit because a plan may allow parallel work: when
 * `parallel` is set every ready step starts at once, each with its own child,
 * model, and permission profile.
 * @param {object} ctx
 * @param {object} agent
 * @param {{step?: number, parallel?: boolean, signal?: AbortSignal}} options
 * @returns {Promise<string>}
 */
export async function runStep(ctx, agent, options = {}) {
  const callerSignal = cancellationSignal(options.signal)
  const cwd = await ensureCwd(ctx, agent, callerSignal)
  const file = planFile(cwd, agent)
  const plan = readPlanFile(file)
  if (plan === undefined) throw new Error(`还没有计划文件（${file}）：先调用 plan_write 拆解任务，或用「建计划」按钮`)

  // The human gate. A revised plan withdraws it, so a model that "just goes
  // ahead" gets refused here instead of quietly spending the user's quota.
  if (!isApproved(plan)) {
    throw new Error(
      `这份计划还没确认（${file}）：先在对话下面的「计划」面板里点「确认计划」，`
      + '或者发送 /slice approve。确认之前不会拉起任何子代理。',
    )
  }

  const targets = selectTargets(plan, options)
  if (targets.length === 0) {
    touchPlanIndex(agent, cwd, file)
    const picked = pickStep(plan, Number.isFinite(options.step) ? Number(options.step) : undefined)
    return `无需执行：${picked.error}。计划文件：${file}`
  }

  const sessionId = sessionIdOf(agent)
  const live = activeRuns.get(sessionId)
  if (live !== undefined) {
    const busy = targets.filter((step) => live.steps.has(step.n)).map((step) => step.n)
    if (busy.length > 0) {
      return `第 ${busy.join('、')} 步正在执行中，不会重复启动。等它结束，或先 /slice stop 停止再继续。`
    }
  }

  const controller = new AbortController()
  const abortOnCaller = () => { controller.abort() }
  if (callerSignal.aborted) controller.abort()
  else callerSignal.addEventListener('abort', abortOnCaller, { once: true })
  activeRuns.set(sessionId, { controller, steps: new Set(targets.map((step) => step.n)) })

  const outcomes = []
  try {
    const batches = await Promise.all(targets.map((step) => startStep({
      ctx, agent, plan, file, cwd, step, signal: controller.signal,
    })))
    for (const batch of batches) outcomes.push(await finishStep({ plan, file, batch, signal: controller.signal, parentSession: sessionId, parentAgent: agent }))
  } finally {
    callerSignal.removeEventListener('abort', abortOnCaller)
    activeRuns.delete(sessionId)
    writePlanFile(file, plan)
    touchPlanIndex(agent, cwd, file)
  }
  return summarize({ plan, file, outcomes, parallel: targets.length > 1, stopped: controller.signal.aborted })
}

/**
 * Which steps this call runs: an addressed step, or every ready step when the
 * caller asked for parallel work, or the single next one.
 * @param {{steps: object[]}} plan
 * @param {{step?: number, parallel?: boolean}} options
 * @returns {object[]}
 */
function selectTargets(plan, options) {
  if (Number.isFinite(options.step)) {
    const picked = pickStep(plan, Number(options.step))
    return picked.step === undefined ? [] : [picked.step]
  }
  if (options.parallel === true) return readySteps(plan)
  const picked = pickStep(plan, undefined)
  return picked.step === undefined ? [] : [picked.step]
}

/**
 * Mirror the plan into the session's todo list.
 *
 * `todo_write` is an ordinary session event: `todo/write` with a whole list,
 * folded by the `todos` projection and rendered by the conversation UI as the
 * 「任务」 card. Appending it ourselves keeps that card — which lives in the big
 * conversation, not in our popover — in sync with every step transition, so the
 * reader sees 进行中 / 待办 / 已完成 change as the children run.
 *
 * Never throws: a session that cannot take the event (or a projection that is not
 * mounted) must not break a running step.
 * @param {object} agent
 * @param {{steps?: Array<object>}} plan
 * @returns {boolean} whether the event was appended
 */
export function mirrorPlanToTodos(agent, plan) {
  try {
    const session = agent?.session
    const steps = Array.isArray(plan?.steps) ? plan.steps : []
    if (session === undefined || typeof session.append !== 'function' || steps.length === 0) return false
    const todos = steps.map((step) => ({
      // The number makes every line unique (todo_write rejects duplicate content)
      // and keeps the card aligned with the plan the user is reading.
      content: `${step.n}. ${String(step.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 96) || '步骤'}`,
      status: step.status === STATUS.done
        ? 'completed'
        : step.status === STATUS.doing ? 'in_progress' : 'pending',
    }))
    session.append('todo/write', { todos })
    return true
  } catch {
    return false
  }
}

/**
 * Mark one step running and start its child. The plan file is rewritten before
 * the child exists, so the panel can show "who is running" while it runs.
 * @param {{ctx: object, agent: object, plan: object, file: string, cwd: string, step: object, signal: AbortSignal}} input
 * @returns {Promise<object>} the in-flight batch record
 */
async function startStep({ ctx, agent, plan, file, cwd, step, signal }) {
  const route = parseRoute(step.model)
  // A step that names neither a permission profile nor a tool list inherits the
  // profile default the user saved in the panel.
  const inherited = step.access === '' && normalizeNames(step.hidden).length === 0 ? readPlanDefaults() : { access: '', hidden: [] }
  const effective = inherited.access === '' && inherited.hidden.length === 0
    ? step
    : { access: step.access === '' ? inherited.access : step.access, hidden: step.hidden.length > 0 ? step.hidden : inherited.hidden }
  const hidden = stepDenyList(effective, agent)
  const childId = randomUUID()

  step.status = STATUS.doing
  step.startedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  writePlanFile(file, plan)
  // Keep the conversation's 任务 card live: it is the reader's view of "which
  // step is running" while the child works.
  mirrorPlanToTodos(agent, plan)

  reserveStepTools(childId, hidden)
  reserveChildActivity(childId, { parent: sessionIdOf(agent), step: step.n })
  resetStepActivity(sessionIdOf(agent), step.n)
  startStepStats(sessionIdOf(agent), step.n)
  const batch = { step, childId, hidden, activation: undefined, error: undefined }
  try {
    if (route !== undefined) await assertRoute(ctx, route, signal)
    batch.activation = await subagentsOf(ctx).startActivation({
      provider: 'spawn',
      childId,
      label: `step ${step.n}`,
      prompt: [{ type: 'text', text: workerPrompt({ goal: plan.goal, file, cwd, step, steps: plan.steps }) }],
      parent: agent,
      signal,
      delivery: 'caller',
      ...(route === undefined ? {} : { agentOptions: route }),
    })
  } catch (error) {
    releaseStepTools(childId)
    batch.error = error
  }
  return batch
}

/**
 * Wait for one started step and fold its result into the plan.
 * @param {{plan: object, file: string, batch: object, signal: AbortSignal}} input
 * @returns {Promise<{step: object, kind: 'done'|'failed'|'cancelled', report: string, detail: string}>}
 */
async function finishStep({ plan, file, batch, signal, parentSession, parentAgent }) {
  const { step } = batch
  const who = `模型：${modelLabel(step)} · 权限：${accessLabel(step)}`
  const settle = (kind, record) => {
    step.startedAt = ''
    step.status = kind === 'done' ? STATUS.done : kind === 'cancelled' ? STATUS.cancelled : STATUS.failed
    step.record = record
    childActivityTarget.delete(batch.childId)
    pendingActivityTarget.delete(batch.childId)
    endStepStats(parentSession, step.n)
    pushActivity({ parent: parentSession, step: step.n }, [
      `— ${kind === 'done' ? '完成' : kind === 'cancelled' ? '已取消' : '失败'}`,
    ])
    writePlanFile(file, plan)
    if (parentAgent !== undefined) mirrorPlanToTodos(parentAgent, plan)
    return { step, kind, report: kind === 'done' ? step.record : '', detail: record, who }
  }

  if (batch.error !== undefined) {
    // A cancelled start is a user stop, not a failure of the step.
    if (signal.aborted) return settle('cancelled', '已取消：开始前就被停止了')
    return settle('failed', `子代理启动失败：${messageOf(batch.error)}`)
  }
  if (batch.hidden.length === 0) releaseStepTools(batch.childId)

  try {
    const result = await batch.activation?.result
    releaseStepTools(batch.childId)
    const output = textOf(result?.output)
    const reason = String(result?.stopReason ?? 'unknown')
    if (signal.aborted || reason === 'aborted' || reason === 'interrupted') {
      return settle('cancelled', `已取消（${reason}）：${clampReport(output || '用户停止', 400)}`)
    }
    if (reason !== 'completed' || output === '') {
      return settle('failed', `未完成（${reason}）：${String(result?.diagnostic ?? output ?? '子代理没有输出').slice(0, 800)}`)
    }
    return settle('done', clampReport(output, RECORD_CHARS))
  } catch (error) {
    releaseStepTools(batch.childId)
    if (signal.aborted) return settle('cancelled', `已取消：${messageOf(error)}`)
    return settle('failed', `子代理执行出错：${messageOf(error)}`)
  }
}

/**
 * The text one batch returns: what happened, the whole plan's statuses, and
 * where the run stands. Every result repeats the full table so a reader of the
 * conversation can see all steps, including the ones that have not started.
 * @param {{plan: object, file: string, outcomes: object[], parallel: boolean, stopped: boolean}} input
 * @returns {string}
 */
function summarize({ plan, file, outcomes, parallel, stopped }) {
  const lines = []
  if (stopped) {
    lines.push(`【已停止】第 ${outcomes.map((outcome) => outcome.step.n).join('、')} 步被取消，没有继续执行。`)
  }
  for (const outcome of outcomes) {
    const { step, kind } = outcome
    if (kind === 'done') {
      lines.push(`【第 ${step.n}/${plan.steps.length} 步完成】${step.title}`)
      lines.push(outcome.who)
      if (outcome.step.hidden.length > 0) lines.push(`（这一步关闭了 ${outcome.step.hidden.length} 个工具）`)
      lines.push('子代理报告：', outcome.report, '')
    } else if (kind === 'cancelled') {
      lines.push(`【第 ${step.n} 步已取消】${step.title}`)
      lines.push(outcome.who)
      lines.push(outcome.detail, '')
    } else {
      lines.push(`【第 ${step.n} 步失败】${step.title}`)
      lines.push(outcome.who)
      lines.push(outcome.detail, '')
    }
  }
  if (parallel) lines.push(`（这一批并行跑了 ${outcomes.length} 步）`)
  lines.push(`进度：${progressLine(plan)}`)
  const table = statusTable(plan)
  if (table !== '') lines.push('', '计划状态：', table)

  const next = nextStep(plan)
  if (next === undefined) {
    const unfinished = (plan.steps ?? []).filter((step) => step.status !== STATUS.done)
    if (unfinished.length === 0) {
      lines.push('', `全部 ${plan.steps.length} 步已完成。计划文件：${file}`)
      lines.push('现在用 5–10 行中文向用户总结：改了什么、怎么验证的、还剩什么问题。')
    } else {
      lines.push('', `没有可立即执行的步骤：${unfinished.map((step) => `第 ${step.n} 步`).join('、')} 在等前置步骤。`)
      lines.push('先完成或重跑它们依赖的步骤，或用 plan_write 调整依赖。')
    }
  } else {
    const ready = readySteps(plan)
    lines.push('', `【下一步 · 第 ${next.n} 步】${next.title}`)
    lines.push(`做什么：${next.task}`)
    if (next.done !== '') lines.push(`完成标准：${next.done}`)
    lines.push(`模型：${modelLabel(next)} · 权限：${accessLabel(next)}`)
    if (ready.length > 1) {
      lines.push(`现在有 ${ready.length} 步互不依赖（第 ${ready.map((step) => step.n).join('、')} 步），用户可以在面板点「并行执行」一起跑。`)
    }
    lines.push(`→ 继续调用 step_run（省略参数即执行第 ${next.n} 步）。`)
  }
  return lines.join('\n')
}

/**
 * Record where one session's plan lives without needing a live Agent. The panel
 * edits plans while no model runs, so the index is its only handle.
 * @param {string} sessionId
 * @param {string} cwd
 * @param {string} file
 */
export function recordPlanLocation(sessionId, cwd, file) {
  try {
    const index = readPlanIndex()
    const merged = mergeSessions(index, String(sessionId), {
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
 * Where a Session's plan lives, read from the index the plan tools maintain.
 * @param {string} sessionId
 * @returns {{file: string, cwd: string} | undefined}
 */
export function indexedLocation(sessionId) {
  const entry = readPlanIndex().sessions[String(sessionId)]
  if (entry === undefined || typeof entry.file !== 'string') return undefined
  return { file: entry.file, cwd: typeof entry.cwd === 'string' ? entry.cwd : path.dirname(entry.file) }
}

/**
 * Apply one mutation to a plan found through the index, then rewrite it.
 * @param {string} sessionId
 * @param {(plan: object, file: string) => object} mutate
 * @returns {{plan: object, file: string}}
 */
function editIndexedPlan(sessionId, mutate) {
  const location = indexedLocation(sessionId)
  if (location === undefined) throw new Error('这个会话还没有计划：先让模型用 plan_write 拆解，或在面板里「开始规划」')
  const plan = readPlanFile(location.file)
  if (plan === undefined) throw new Error(`计划文件为空或读不到：${location.file}`)
  const next = mutate(plan, location.file)
  writePlanFile(location.file, next)
  recordPlanLocation(sessionId, location.cwd, location.file)
  return { plan: next, file: location.file }
}

/**
 * Confirm or withdraw a plan from the panel, with no Agent in scope.
 * @param {string} sessionId
 * @param {boolean} approved
 * @returns {{plan: object, file: string}}
 */
export function approveIndexedPlan(sessionId, approved) {
  return editIndexedPlan(sessionId, (plan) => markApproved(plan, approved))
}

/**
 * Set one step's model and/or tool policy from the panel.
 * @param {string} sessionId
 * @param {{step: number, model?: string, hidden?: string[]}} edit
 * @returns {{plan: object, file: string}}
 */
export function configureIndexedStep(sessionId, edit) {
  return editIndexedPlan(sessionId, (plan) => {
    const patched = patchStep(plan, Number(edit.step), {
      ...(edit.model === undefined ? {} : { model: edit.model }),
      ...(edit.hidden === undefined ? {} : { hidden: edit.hidden }),
      ...(edit.access === undefined ? {} : { access: edit.access }),
    })
    if (patched.error !== undefined) throw new Error(patched.error)
    return patched.plan
  })
}

/**
 * Confirm or withdraw the plan's human gate from the model side.
 * @param {object} ctx
 * @param {object} agent
 * @param {boolean} approved
 * @returns {Promise<{plan: object, file: string}>}
 */
export async function setApproved(ctx, agent, approved) {
  const cwd = await ensureCwd(ctx, agent, undefined)
  const file = planFile(cwd, agent)
  const plan = readPlanFile(file)
  if (plan === undefined) throw new Error(`还没有计划文件（${file}）`)
  const next = markApproved(plan, approved)
  writePlanFile(file, next)
  touchPlanIndex(agent, cwd, file)
  return { plan: next, file }
}

/**
 * Set one step's model and/or tool policy, addressed by the Agent.
 * @param {object} ctx
 * @param {object} agent
 * @param {{step: number, model?: string, hidden?: string[]}} edit
 * @returns {Promise<{plan: object, file: string}>}
 */
export async function editStep(ctx, agent, edit) {
  const cwd = await ensureCwd(ctx, agent, undefined)
  const file = planFile(cwd, agent)
  const plan = readPlanFile(file)
  if (plan === undefined) throw new Error(`还没有计划文件（${file}）`)
  const patched = patchStep(plan, Number(edit.step), {
    ...(edit.model === undefined ? {} : { model: edit.model }),
    ...(edit.hidden === undefined ? {} : { hidden: edit.hidden }),
  })
  if (patched.error !== undefined) throw new Error(patched.error)
  writePlanFile(file, patched.plan)
  touchPlanIndex(agent, cwd, file)
  return { plan: patched.plan, file }
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
  const lines = [
    `# ${view.goal || '（无目标）'}`,
    `进度：${view.progress}`,
    `确认：${view.approved ? `已确认（${view.approvedAt}）` : '未确认——先在面板点「确认计划」或发送 /slice approve'}`,
    `文件：${file}`,
  ]
  if (view.current !== null) {
    lines.push(`下一步：第 ${view.current.n} 步 ${view.current.title}`)
    if (view.current.task !== '') lines.push(`做什么：${view.current.task}`)
  }
  for (const step of view.steps) {
    const tools = step.hidden.length > 0 ? ` · 关闭 ${step.hidden.length} 个工具` : ''
    lines.push(`${step.n}. [${step.status}] ${step.title} · 模型 ${step.model === '' ? '继承' : step.model} · 权限 ${step.access === '' ? '全量' : step.access}${tools}`)
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
    '3. 计划写完后**停下来**：用不超过 8 行复述计划要点（每步一句话），等我确认。',
    '',
    '注意：计划写出来以后**不会**自动开跑。我会在对话下面的「计划」面板里，为每一步选好模型和允许用的工具，'
    + '再点「确认计划」；在那之前 step_run 会被直接拒绝。所以你不用催我，也不要自己调 step_run。',
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
 * The message the panel sends when the user asks for automatic sequential
 * execution: run the remaining steps one after another without stopping between
 * them. Every step still comes back into the conversation as a `step_run`
 * result, which is where the user reads what each child actually did.
 * @param {{goal?: string, steps?: object[]}} plan
 * @returns {string}
 */
export function autoPrompt(plan) {
  const view = planView(plan ?? { steps: [] })
  const next = view.current
  return [
    `我已确认计划，并授权你**自动顺次执行**${next === null ? '' : `，从第 ${next.n} 步开始`}。`,
    '',
    '规则：',
    '1. 直接调用 step_run（省略参数）执行下一个未完成步骤；拿到报告和「计划状态」表后**不要停下来问我**，直接继续调用 step_run 执行下一步。',
    '2. 一直重复到没有可执行步骤、或某一步失败为止。依赖未满足的步骤会被自动跳过。',
    '3. 某步失败就停下：说明失败原因和受影响的后续步骤，等我处理；不要跳过它去跑后面的步。',
    '4. 只有一次就绪 ≥2 步时，仍然一次一步（并行要我在面板上点）。',
    '5. 全部完成后用 5–10 行总结：改了什么、怎么验证的、还剩什么问题。',
    '6. 我一旦说停、或面板点了「停止全部」，立刻停止，把已取消的步骤列出来，然后等我说继续还是重新规划。',
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
    '- 这一步已经足够小：直接动手，不要重新规划、不要写计划、不要长篇说明。',
    '- 直接动手：读必要的文件、改代码、跑命令验证，不要只给建议。',
    '- 只改与本步相关的文件，改动尽量小，沿用仓库已有写法。',
    '- 不要再调用 plan_write 或 step_run：工具表里它们只是随预设一起挂载，你已经是最底层的执行者。',
    '- 不要询问；确实无法继续时，说明卡点和需要什么信息。',
    '- 最后输出不超过 10 行：做了什么 / 改了哪些文件 / 验证结果 / 遗留问题。',
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