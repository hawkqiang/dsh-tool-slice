/**
 * tool-slice Host plugin: keeps a tool mask, applies it to every Agent (parent
 * and child) through `ctx.tools.restrict()`, and serves the browser UI that
 * edits the mask.
 *
 * Masks are per conversation: a session that saved its own switch list keeps
 * it, and every other session follows the profile-wide default. The mask is a
 * deny list, so tools registered later stay visible unless the user unchecks
 * them. Nothing is registered globally except this plugin's own routes and the
 * `/slice` command, and the mask costs no prompt tokens by itself.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  groupTools, estimateTokens, normalizeHidden, normalizeScenarios, resolveHidden, builtInScenarios,
  planView, parsePlan, parseSliceCommand, clampReport, readySteps, isApproved,
} from './core.mjs'
import {
  readPlanIndex, runStep, planStatusText, planRequestPrompt, revisePrompt, autoPrompt, planFile, readPlanFile, ensureCwd,
  messageOf as sliceMessage, listModelRoutes, setApproved, approveIndexedPlan, configureIndexedStep,
  stopSession, sessionIdOf, isRunning, stepStatsOf,
} from './workflow.mjs'

export const name = 'tool-slice'
export const inject = ['tools']

const STATE_VERSION = 2
const MAX_SCENARIOS = 24
const MAX_HIDDEN = 400
const MAX_SESSIONS = 200

/**
 * Record every declared preset's activation diagnostic beside the state file.
 *
 * The roster a user sees in Settings reports "加载失败" from `AgentPreset.broken`,
 * whose text the browser only shows on hover; writing it next to the switch
 * state makes a broken preset composition diagnosable without a debugger.
 *
 * The read is deferred: `agentPresets.list()` re-audits against the settled Host
 * tree, and awaiting that inside this Host row's own activation would deadlock.
 * Best effort throughout — a diagnostic must never break the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} statePath the switch-state file, whose directory owns the report
 */
function reportPresets(ctx, statePath) {
  const timer = setTimeout(async () => {
    try {
      const presets = ctx.get('agentPresets')
      if (!presets || typeof presets.list !== 'function') return
      const rows = await presets.list()
      const report = {
        at: new Date().toISOString(),
        presets: rows.map((row) => ({
          id: row.id,
          name: row.name ?? '',
          broken: row.broken ?? '',
        })),
      }
      const target = path.join(path.dirname(statePath), 'tool-slice-presets.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    } catch {
      /* the roster is a diagnostic, never a prerequisite */
    }
  }, 5000)
  ctx.effect(() => () => clearTimeout(timer))
}

/**
 * Session id of an Agent, without assuming a particular Session shape.
 * @param {object} agent
 * @returns {string}
 */
function sessionOf(agent) {
  try {
    return String(agent?.session?.id ?? '')
  } catch {
    return ''
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const statePath = resolveStatePath()
  reportPresets(ctx, statePath)
  let state
  try {
    state = loadState(statePath)
  } catch {
    // A malformed state file must not stop the plugin from loading.
    state = {
      version: STATE_VERSION, revision: 1, hidden: [], scenarios: [], sessions: {}, planDefaults: { access: '', hidden: [] },
    }
  }
  /** Canonical form of the accepted file contents, to detect hand edits. */
  let acceptedKey = canonicalKey(state)
  /** @type {WeakMap<object, {known: Set<string>, dispose?: () => void, key: string}>} */
  const agents = new WeakMap()
  /** @type {{tools: Array<{name: string, tokens: number, summary: string}>, totalTokens: number} | undefined} */
  let inventory

  const knownNames = () => new Set((inventory?.tools ?? []).map((tool) => tool.name))

  function log(message) {
    try {
      ctx.logger?.warn?.(`tool-slice: ${message}`)
    } catch {
      /* logging must never break the agent */
    }
  }

  /**
   * Adopt a state file edited by hand. The page writes through `save()`, so
   * reaching the same parser here keeps one source of truth and lets users fix
   * the mask in an editor. A missing, half-written, or malformed file keeps
   * the last accepted value instead of failing the step.
   */
  function syncFromFile() {
    let fresh
    try {
      fresh = loadState(statePath)
    } catch {
      return
    }
    const key = canonicalKey(fresh)
    if (key === acceptedKey) return
    acceptedKey = key
    state.hidden = fresh.hidden
    state.scenarios = fresh.scenarios
    state.sessions = fresh.sessions
    state.revision += 1
  }

  /** Union of every tool seen in any Agent, so several presets all appear. */
  const seenTools = new Map()

  /** Record every tool this Agent can currently see; the page lists these. */
  function captureInventory(agent) {
    const definitions = agent.ctx.tools.definitions(agent)
    for (const definition of definitions) {
      seenTools.set(definition.name, {
        name: definition.name,
        tokens: estimateTokens(JSON.stringify({
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        }).length),
        summary: summarize(definition.description),
      })
    }
    const tools = [...seenTools.values()].sort((a, b) => a.name.localeCompare(b.name))
    inventory = {
      tools,
      totalTokens: tools.reduce((sum, tool) => sum + tool.tokens, 0),
    }
  }

  /** Apply the mask of one Agent's own conversation, reusing the previous restriction. */
  function applyMask(agent) {
    const seen = agents.get(agent)
    if (seen === undefined) return
    if (seen.key === state.revision) return
    const resolved = resolveHidden(state, sessionOf(agent))
    const deny = resolved.hidden.filter((name) => seen.known.has(name))
    try {
      seen.dispose?.()
    } catch (error) {
      log(`lifting the previous restriction failed: ${messageOf(error)}`)
    }
    seen.dispose = undefined
    try {
      if (deny.length > 0) seen.dispose = agent.ctx.tools.restrict({ deny })
    } catch (first) {
      // A name this Agent cannot restrict (unknown here, registered later, or
      // scope-local) fails the whole filter: retry with what is visible now.
      try {
        const visible = new Set(agent.ctx.tools.definitions(agent).map((definition) => definition.name))
        const narrowed = deny.filter((name) => visible.has(name))
        seen.dispose = narrowed.length > 0 ? agent.ctx.tools.restrict({ deny: narrowed }) : undefined
      } catch (second) {
        log(`restriction failed: ${messageOf(second)} (first attempt: ${messageOf(first)})`)
        return
      }
    }
    seen.key = state.revision
  }

  /**
   * Register an Agent the first time it is seen. A plugin enabled while
   * Sessions are already running never observes their `agent/created`, so the
   * pre-step path calls this too: the mask must reach live Agents.
   * @param {object} agent
   */
  function ensureAgent(agent) {
    if (agents.has(agent)) return
    try {
      captureInventory(agent)
    } catch (error) {
      log(`tool inventory unavailable: ${messageOf(error)}`)
    }
    agents.set(agent, {
      known: new Set((inventory?.tools ?? []).map((tool) => tool.name)),
      key: '',
    })
  }

  ctx.on('agent/created', ({ agent }) => {
    ensureAgent(agent)
    try {
      applyMask(agent)
    } catch (error) {
      log(`initial restriction failed: ${messageOf(error)}`)
    }
  }, { global: true })

  ctx.on('agent/disposed', ({ agent }) => {
    const seen = agents.get(agent)
    try {
      seen?.dispose?.()
    } catch {
      /* the Agent is going away */
    }
  }, { global: true })

  // A saved mask takes effect at the next model step, for Agents already
  // running, and a hand-edited state file is adopted on the same step.
  ctx.on('agent/pre-step', ({ agent }, next) => {
    try {
      ensureAgent(agent)
      syncFromFile()
      applyMask(agent)
    } catch (error) {
      log(`restriction at pre-step failed: ${messageOf(error)}`)
    }
    return next()
  })

  // The browser page needs the live tool inventory; without a Web connection
  // the mask still applies and the file stays editable by hand.
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/state',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => Promise.resolve(Response.json(snapshot(request), { headers: { 'cache-control': 'no-store' } })),
    }))
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/save',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => save(request),
    }))
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/plan',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => Promise.resolve(planSnapshot(request)),
    }))
    // The panel is the only place a step's model and tool policy can be set:
    // the model-facing tools deliberately accept neither, so a step runs with
    // exactly what the human chose.
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/step',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => editStepRoute(request),
    }))
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/approve',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => approveRoute(request),
    }))
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/models',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (_request) => Promise.resolve(modelsSnapshot()),
    }))
    // Scenarios are shared definitions, so creating or deleting one is its own
    // call: it must never be mixed into a draft save that could overwrite the
    // other conversations' switch lists.
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/tool-slice/scenario',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => saveScenario(request),
    }))
  })

  // `/slice` is the human face of the same step machinery `step_run` uses: the
  // dock buttons call it, and it is discoverable in the composer's command
  // menu. Global registration keeps it available in every session; the Agent
  // passed to the handler decides which plan file it reads.
  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register({
      name: 'slice',
      description: 'plan-act：先讨论再拆成小步计划（plan），再逐步执行（act）；可确认/取消确认、修订计划、查看进度',
      input: { hint: '[plan <目标> | revise <意见> | approve | unapprove | next [步骤号] | show]' },
      handler: ({ agent, rawInput }) => sliceCommand(ctx, agent, rawInput),
    }))
  })

  /**
   * The preset id a Session committed to, when the registry can tell us.
   * @param {object} agent
   * @returns {string}
   */
  function presetOf(agent) {
    try {
      const presets = ctx.get('agentPresets')
      const id = presets?.presetForSession?.(agent?.session)
      return typeof id === 'string' && id !== '' ? id : '未知'
    } catch {
      return '未知'
    }
  }

  /**
   * Explain the missing tool when this Session's preset does not mount the
   * plan-act tools.
   *
   * The dock is mounted profile-wide while `plan_write`/`step_run` belong to the
   * preset, so a session on another preset shows the buttons but has nothing
   * behind them — which reads as "I clicked and nothing happened". A hand-written
   * `write` plan file is not our format and must not be pretended into one.
   * @param {object} agent
   * @returns {string | undefined} the refusal text, or undefined when usable
   */
  function missingPlanTools(agent) {
    try {
      const names = new Set(agent.ctx.tools.definitions(agent).map((definition) => definition.name))
      const missing = ['plan_write', 'step_run'].filter((name) => !names.has(name))
      if (missing.length === 0) return undefined
      return `这个会话的预设是「${presetOf(agent)}」，没有 plan-act 的计划工具（缺 ${missing.join('、')}）：`
        + '计划面板只能读计划文件、确认计划，不能替这个预设规划或执行。'
        + '请新开一个预设选 plan-act 的会话再做这件事。'
    } catch {
      return undefined
    }
  }

  /**
   * One grammar, three callers: the composer, the dock buttons, and `/slice`.
   * @param {object} context Host context (services are resolved lazily by workflow.mjs)
   * @param {object} agent receiving Agent
   * @param {string} rawInput text after `slice`
   * @returns {Promise<{kind: 'success' | 'error', text: string}>}
   */
  async function sliceCommand(context, agent, rawInput) {
    const parsed = parseSliceCommand(rawInput)
    if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
    if (parsed.action === 'plan' || parsed.action === 'next' || parsed.action === 'revise' || parsed.action === 'parallel' || parsed.action === 'auto') {
      const missing = missingPlanTools(agent)
      if (missing !== undefined) return { kind: 'error', text: missing }
    }
    try {
      if (parsed.action === 'auto') {
        // Automatic sequencing is a conversation mode, not a host loop: the model
        // keeps calling step_run, so every step's child report lands in the
        // transcript where the user can read it, and the human gate stays intact.
        const view = await planStatusText(context, agent)
        let plan
        try {
          const cwd = await ensureCwd(context, agent, undefined)
          plan = readPlanFile(planFile(cwd, agent))
        } catch {
          plan = undefined
        }
        if (plan === undefined) return { kind: 'error', text: '还没有计划：先让模型拆解，或点「开始规划」。' }
        if (!isApproved(plan)) {
          return { kind: 'error', text: '这份计划还没确认：先在面板点「确认计划」，或发送 /slice approve。' }
        }
        if (readySteps(plan).length === 0) {
          return { kind: 'success', text: `没有可立即执行的步骤，未启动自动执行。${view.split('\n').slice(0, 4).join('\n')}` }
        }
        const followup = agent?.followup
        if (typeof followup !== 'function') {
          return { kind: 'error', text: '这个会话无法从指令注入消息：请直接在输入框里说“按计划顺次执行”。' }
        }
        await followup.call(agent, {
          content: [{ type: 'text', text: autoPrompt(plan) }],
          source: { kind: 'user' },
        })
        return {
          kind: 'success',
          text: '已开始自动顺次执行：模型会一步步调用 step_run，每步的报告都会出现在对话里；要停就点「停止全部」或 /slice stop。',
        }
      }
      if (parsed.action === 'plan' || parsed.action === 'revise') {
        // Both actions only talk: they ask the model to clarify or re-plan and
        // stop there. Starting work stays an explicit, separate decision.
        const followup = agent?.followup
        if (typeof followup !== 'function') {
          return { kind: 'error', text: '这个会话无法从指令注入消息：请直接在输入框里描述目标。' }
        }
        const goal = parsed.action === 'revise' ? await planGoalOf(context, agent) : ''
        await followup.call(agent, {
          content: [{ type: 'text', text: parsed.action === 'plan'
            ? planRequestPrompt(parsed.goal ?? '')
            : revisePrompt(parsed.feedback ?? '', goal) }],
          source: { kind: 'user' },
        })
        return {
          kind: 'success',
          text: parsed.action === 'plan'
            ? '已把目标交给模型：它会先问几个关键问题（如果有），再写计划并停下等你确认。'
            : '已把修订意见交给模型：它改完计划会停下等你确认，已完成的步骤不会丢。',
        }
      }
      if (parsed.action === 'approve' || parsed.action === 'unapprove') {
        const approved = parsed.action === 'approve'
        const result = await setApproved(context, agent, approved)
        return {
          kind: 'success',
          text: approved
            ? `已确认这份计划（${result.plan.steps.length} 步）：现在可以让模型执行下一步，模型自己调用 step_run 也不会再被拒绝。`
            : `已取消确认：step_run 会重新被拒绝，直到你再确认一次。`,
        }
      }
      if (parsed.action === 'next') {
        const text = await runStep(context, agent, { step: parsed.step })
        return { kind: 'success', text: clampReport(text, 1600) }
      }
      if (parsed.action === 'parallel') {
        // Only steps whose dependencies are satisfied start, so a parallel batch
        // never races a step that has to wait for another one.
        const text = await runStep(context, agent, { parallel: true })
        return { kind: 'success', text: clampReport(text, 1600) }
      }
      if (parsed.action === 'stop') {
        const stopped = stopSession(sessionIdOf(agent))
        return {
          kind: 'success',
          text: stopped
            ? '已请求停止：正在跑的步骤会标记为「已取消」，不会算完成。之后点「继续」重跑它们，或点「重新规划」。'
            : '现在没有在执行的步骤可停止。',
        }
      }
      return { kind: 'success', text: await planStatusText(context, agent) }
    } catch (error) {
      return { kind: 'error', text: sliceMessage(error) }
    }
  }

  /**
   * The goal line of the session's current plan, used to give the model context
   * when the user only sends revision feedback.
   * @param {object} context
   * @param {object} agent
   * @returns {Promise<string>}
   */
  async function planGoalOf(context, agent) {
    try {
      const cwd = await ensureCwd(context, agent, undefined)
      const plan = readPlanFile(planFile(cwd, agent))
      return plan?.goal ?? ''
    } catch {
      return ''
    }
  }

  /** The `session` query parameter every panel route carries. */
  function sessionParam(request) {
    try {
      return new URL(request?.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
    } catch {
      return ''
    }
  }

  /**
   * Every provider the LLM runtime serves, with the models it advertises: the
   * panel's model picker is built from this, never from a hard-coded list.
   * @returns {Promise<Response>}
   */
  async function modelsSnapshot() {
    const headers = { 'cache-control': 'no-store' }
    try {
      return Response.json({ ok: true, routes: await listModelRoutes(ctx) }, { headers })
    } catch (error) {
      return Response.json({ ok: false, error: sliceMessage(error), routes: [] }, { headers })
    }
  }

  /**
   * Confirm or withdraw the plan from the panel. No Agent is involved: the
   * index the plan tools maintain resolves the file, so this works with the
   * page open and no model running.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async function approveRoute(request) {
    const headers = { 'cache-control': 'no-store' }
    const sessionId = sessionParam(request)
    if (sessionId === '') return Response.json({ ok: false, error: '缺少会话 ID' }, { status: 400, headers })
    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers })
    }
    if (body === null || typeof body !== 'object') {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers })
    }
    try {
      const { plan, file } = approveIndexedPlan(sessionId, body.approved !== false)
      return Response.json({ ok: true, plan: planView(plan, { file }), file }, { headers })
    } catch (error) {
      return Response.json({ ok: false, error: sliceMessage(error) }, { status: 400, headers })
    }
  }

  /**
   * Write one step's model and/or tool policy from the panel.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async function editStepRoute(request) {
    const headers = { 'cache-control': 'no-store' }
    const sessionId = sessionParam(request)
    if (sessionId === '') return Response.json({ ok: false, error: '缺少会话 ID' }, { status: 400, headers })
    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers })
    }
    if (body === null || typeof body !== 'object') {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers })
    }
    const step = Number(body.step)
    if (!Number.isInteger(step) || step < 1) {
      return Response.json({ ok: false, error: '步骤号无效' }, { status: 400, headers })
    }
    try {
      const { plan, file } = configureIndexedStep(sessionId, {
        step,
        ...(body.model === undefined ? {} : { model: String(body.model) }),
        ...(body.hidden === undefined ? {} : { hidden: Array.isArray(body.hidden) ? body.hidden.map(String) : [] }),
        ...(body.access === undefined ? {} : { access: String(body.access) }),
      })
      return Response.json({
        ok: true,
        plan: planView(plan, {
          file,
          running: isRunning(sessionId),
          stats: stepStatsOf(sessionId),
          defaults: state.planDefaults,
        }),
        file,
      }, { headers })
    } catch (error) {
      return Response.json({ ok: false, error: sliceMessage(error) }, { status: 400, headers })
    }
  }

  /**
   * The dock's read-only view of one session's plan, resolved through the index
   * `plan_write`/`step_run` maintain. No Agent is needed, so the page keeps
   * working after a page refresh with no model step in flight.
   * @param {Request} request
   * @returns {Response}
   */
  function planSnapshot(request) {
    const headers = { 'cache-control': 'no-store' }
    const sessionId = sessionParam(request)
    const entry = readPlanIndex().sessions[String(sessionId)]
    if (entry === undefined || typeof entry.file !== 'string') {
      return Response.json({ ok: true, plan: null, reason: 'no-plan' }, { headers })
    }
    let markdown
    try {
      markdown = fs.readFileSync(entry.file, 'utf8')
    } catch (error) {
      return Response.json({
        ok: true, plan: null, reason: 'unreadable', file: entry.file, error: sliceMessage(error),
      }, { headers })
    }
    const parsed = parsePlan(markdown)
    if (parsed.steps.length === 0) {
      return Response.json({ ok: true, plan: null, reason: 'empty', file: entry.file }, { headers })
    }
    return Response.json({
      ok: true,
      plan: planView(parsed, {
        file: entry.file,
        updatedAt: entry.updatedAt ?? '',
        running: isRunning(sessionId),
        stats: stepStatsOf(sessionId),
        defaults: state.planDefaults,
      }),
    }, { headers })
  }

  /**
   * The mask one caller sees: the profile default, or the session's own switch
   * list when it has one. `session` is also how the browser tells the two apart.
   * @param {Request} [request]
   * @returns {object}
   */
  function snapshot(request) {
    const tools = inventory?.tools ?? []
    let sessionId = ''
    try {
      sessionId = new URL(request?.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
    } catch {
      sessionId = ''
    }
    const resolved = resolveHidden(state, sessionId)
    const hidden = new Set(resolved.hidden)
    const enabled = tools.filter((tool) => !hidden.has(tool.name))
    const override = sessionId === '' ? undefined : state.sessions[sessionId]
    return {
      version: STATE_VERSION,
      ready: inventory !== undefined,
      revision: state.revision,
      // `hidden` is the list that applies to this caller; `globalHidden` and
      // `session` let the UI say where it came from and offer "follow global".
      hidden: resolved.hidden,
      globalHidden: state.hidden,
      source: resolved.source,
      session: sessionId === '' ? null : {
        id: sessionId,
        override: resolved.source === 'session',
        updatedAt: override?.updatedAt ?? '',
      },
      scenarios: state.scenarios,
      builtInScenarios: builtInScenarios(tools),
      tools,
      groups: groupTools(tools),
      totalTokens: inventory?.totalTokens ?? 0,
      enabledTokens: enabled.reduce((sum, tool) => sum + tool.tokens, 0),
      enabledCount: enabled.length,
      statePath,
    }
  }

  /**
   * Save either the profile default (`session` absent) or one conversation's own
   * switch list. Saving a session never touches the default, which is exactly
   * the cross-talk the per-conversation mask fixes.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  /**
   * Create, replace, or delete one scenario without touching any conversation's
   * switch list. The panel and the Plugins page both call it, so a scheme can be
   * defined right where you use it.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async function saveScenario(request) {
    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 })
    }
    if (body === null || typeof body !== 'object') {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 })
    }
    const action = String(body.action ?? 'save')
    const known = knownNames()
    const knownSet = known.size > 0 ? known : undefined
    try {
      if (action === 'delete') {
        const name = String(body.name ?? '').trim()
        state.scenarios = state.scenarios.filter((scenario) => scenario.name !== name)
      } else {
        const scenario = normalizeScenarios([{
          name: body.name,
          hidden: body.hidden,
          note: body.note,
        }], knownSet, 1)[0]
        if (scenario === undefined) {
          return Response.json({ ok: false, error: '情景需要一个名字' }, { status: 400 })
        }
        const others = state.scenarios.filter((item) => item.name !== scenario.name)
        state.scenarios = [...others, scenario].slice(-MAX_SCENARIOS)
      }
      state.revision += 1
      writeState(statePath, state)
    } catch (error) {
      return Response.json({ ok: false, error: `保存失败：${messageOf(error)}` }, { status: 500 })
    }
    return Response.json({ ok: true, ...snapshot(request) })
  }

  async function save(request) {
    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 })
    }
    if (body === null || typeof body !== 'object') {
      return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 })
    }
    let sessionId = ''
    try {
      sessionId = new URL(request.url, 'http://localhost').searchParams.get('session') ?? ''
    } catch {
      sessionId = ''
    }
    const known = knownNames()
    const knownSet = known.size > 0 ? known : undefined
    const nextHidden = normalizeHidden(body.hidden, knownSet).slice(0, MAX_HIDDEN)
    try {
      if (body.defaults === true) {
        // The step default is profile-wide, so it is never mixed with a session
        // save: a "save this conversation" click must not change every plan.
        state.planDefaults = normalizePlanDefaults({ access: body.access, hidden: nextHidden })
      } else if (sessionId !== '') {
        if (body.followGlobal === true) {
          delete state.sessions[sessionId]
        } else {
          state.sessions[sessionId] = { hidden: nextHidden, updatedAt: new Date().toISOString() }
          trimSessions(state.sessions)
        }
      } else {
        // Only the default switch list: scenarios live on their own route, so a
        // default save can never roll back a scheme defined in another window.
        state.hidden = nextHidden
      }
      state.revision += 1
      writeState(statePath, state)
    } catch (error) {
      return Response.json({ ok: false, error: `保存失败：${messageOf(error)}` }, { status: 500 })
    }
    return Response.json({ ok: true, ...snapshot(request) })
  }
}

/**
 * @param {string} statePath
 */
function loadState(statePath) {
  const fallback = {
    version: STATE_VERSION, revision: 1, hidden: [], scenarios: [], sessions: {}, planDefaults: { access: '', hidden: [] },
  }
  let raw
  try {
    raw = fs.readFileSync(statePath, 'utf8')
  } catch {
    return fallback
  }
  const parsed = JSON.parse(raw)
  return {
    version: STATE_VERSION,
    revision: Number.isFinite(parsed?.revision) ? Number(parsed.revision) : 1,
    hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((name) => typeof name === 'string').sort() : [],
    // `sets` is the pre-0.3 name for what the UI now calls scenarios.
    scenarios: normalizeScenarios(parsed?.scenarios ?? parsed?.sets, undefined, MAX_SCENARIOS),
    sessions: normalizeSessions(parsed?.sessions),
    // What a step gets when the planner leaves the model/permission fields empty.
    planDefaults: normalizePlanDefaults(parsed?.planDefaults),
  }
}

/**
 * The default permission policy a planned step starts from.
 *
 * Keeping this in the profile state (not per plan) is what makes "every step of
 * every plan should be read-only unless I say otherwise" a single setting.
 * @param {unknown} value
 * @returns {{access: string, hidden: string[]}}
 */
function normalizePlanDefaults(value) {
  const access = typeof value?.access === 'string' ? normalizeAccessText(value.access) : ''
  return {
    access,
    hidden: access === '' ? normalizeHidden(value?.hidden, undefined) : [],
  }
}

/**
 * Normalize one access word, accepting both languages the way the client sends
 * it. Kept here because index.js must not import the preset-side module graph.
 * @param {string} value
 * @returns {string}
 */
function normalizeAccessText(value) {
  const text = String(value ?? '').trim()
  if (text === '只读' || text === 'read') return '只读'
  if (text === '读写' || text === 'edit') return '读写'
  if (text === '全量' || text === 'full') return '全量'
  return ''
}

/**
 * Read the per-session overrides, dropping entries a hand edit left malformed.
 * @param {unknown} value
 * @returns {Record<string, {hidden: string[], updatedAt: string}>}
 */
function normalizeSessions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const sessions = {}
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== null && typeof entry === 'object' && Array.isArray(entry.hidden))
    .sort((a, b) => String(b[1].updatedAt ?? '').localeCompare(String(a[1].updatedAt ?? '')))
  for (const [id, entry] of entries) {
    if (id === '' || sessions[id] !== undefined) continue
    sessions[id] = {
      hidden: normalizeHidden(entry.hidden, undefined),
      updatedAt: String(entry.updatedAt ?? ''),
    }
    if (Object.keys(sessions).length >= MAX_SESSIONS) break
  }
  return sessions
}

/**
 * Keep only the newest overrides, so a long-lived profile does not grow one
 * entry per conversation forever.
 * @param {Record<string, {hidden: string[], updatedAt: string}>} sessions
 */
function trimSessions(sessions) {
  const entries = Object.entries(sessions)
  if (entries.length <= MAX_SESSIONS) return
  entries
    .sort((a, b) => String(b[1].updatedAt ?? '').localeCompare(String(a[1].updatedAt ?? '')))
    .slice(MAX_SESSIONS)
    .forEach(([id]) => { delete sessions[id] })
}

/**
 * Compare two accepted states by content, not by the file's `revision`, so a
 * hand edit that changes nothing visible does not restart restrictions.
 * @param {{hidden: string[], scenarios: Array<object>, sessions: Record<string, object>}} state
 * @returns {string}
 */
function canonicalKey(state) {
  return JSON.stringify({
    hidden: [...state.hidden].sort(),
    scenarios: state.scenarios,
    sessions: Object.fromEntries(Object.entries(state.sessions).sort((a, b) => a[0].localeCompare(b[0]))),
    planDefaults: state.planDefaults,
  })
}

/**
 * @param {string} statePath
 * @param {{version: number, revision: number, hidden: string[], scenarios: Array<object>, sessions: Record<string, object>}} state
 */
function writeState(statePath, state) {
  const directory = path.dirname(statePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporary = `${statePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, statePath)
}

function resolveStatePath() {
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile === 'string' && profile !== '') return path.join(profile, 'tool-slice.json')
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'tool-slice.json')
}

function summarize(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 96 ? `${text.slice(0, 96)}…` : text
}

function messageOf(error) {
  return String(error?.message ?? error).slice(0, 200)
}
