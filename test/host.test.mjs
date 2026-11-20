import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'
import { renderPlan, parsePlan } from '../core.mjs'
import { recordPlanLocation, touchPlanIndex } from '../workflow.mjs'

/** Write a plan file for one session and register it where the panel looks. */
function seedPlan(h, sessionId) {
  const dir = path.join(h.profile, '.dsh', 'plans')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `plan-${sessionId.slice(-8)}.md`)
  fs.writeFileSync(file, renderPlan({
    goal: '把登录换成 JWT',
    steps: [
      { n: 1, title: '盘点签发点', task: '读 src/auth', done: '给出清单', status: '待办' },
      { n: 2, title: '实现签发', task: '签 access+refresh', done: '单测通过', status: '待办' },
    ],
  }), 'utf8')
  recordPlanLocation(sessionId, h.profile, file)
  return file
}

function post(h, route, sessionId, body) {
  const url = `http://localhost${route}?session=${encodeURIComponent(sessionId)}`
  return h.routes.get(route).fetch(new Request(url, { method: 'POST', body: JSON.stringify(body) }))
}

/** A minimal Cordis-shaped context with the services this plugin uses. */
function harness() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-slice-host-'))
  process.env.DSH_PROFILE_DIR = profile
  const handlers = new Map()
  const routes = new Map()
  const commands = new Map()
  const warnings = []
  const spawns = []
  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    // A step's child only needs a service that hands back a finished result.
    subagents: {
      startActivation: async (spec) => {
        spawns.push(spec)
        return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: `${spec.label} 完成` }] }) }
      },
    },
    on(name, handler) {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
      return () => {}
    },
    inject(_deps, callback) { callback(ctx) },
    effect(factory) {
      const disposer = factory()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => { routes.delete(route.path) }
        },
      },
    },
    commands: {
      register(definition) {
        commands.set(definition.name, definition)
        return () => { commands.delete(definition.name) }
      },
    },
    workingDirectory: { ensure: async () => profile },
  }
  apply(ctx)
  return {
    profile,
    warnings,
    routes,
    commands,
    spawns,
    fire(name, payload, ...rest) {
      for (const handler of handlers.get(name) ?? []) handler(payload, ...rest)
    },
    stateFile: path.join(profile, 'tool-slice.json'),
    planIndexFile: path.join(profile, 'tool-slice-plans.json'),
  }
}

/** The tools a plan-act session mounts; the dock refuses to plan without them. */
const PLAN_ACT_TOOLS = ['plan_options', 'plan_write', 'step_run', 'read', 'glob', 'grep']

function fakeAgent(id, names, calls) {
  const definitions = names.map((name) => ({
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
  }))
  return {
    id,
    session: { id },
    ctx: {
      tools: {
        definitions: () => definitions,
        restrict(filter) {
          calls.push({ filter })
          return () => { calls.push({ dispose: filter }) }
        },
      },
    },
  }
}

async function state(h) {
  const response = await h.routes.get('/api/tool-slice/state').fetch()
  assert.equal(response.status, 200)
  return response.json()
}

test('the state route is registered and reports no inventory before an agent', async () => {
  const h = harness()
  const snapshot = await state(h)
  assert.equal(snapshot.ready, false)
  assert.deepEqual(snapshot.hidden, [])
  assert.equal(snapshot.totalTokens, 0)
  assert.equal(snapshot.statePath, h.stateFile)
})

test('an agent inventories the tools and is not restricted when nothing is hidden', async () => {
  const h = harness()
  const calls = []
  h.fire('agent/created', { agent: fakeAgent('s-a', ['read', 'write', 'web_search'], calls) })
  const snapshot = await state(h)
  assert.equal(snapshot.ready, true)
  assert.deepEqual(snapshot.tools.map((tool) => tool.name), ['read', 'web_search', 'write'])
  assert.ok(snapshot.totalTokens > 0)
  assert.equal(snapshot.groups.length, 2, 'read/write fold into one filesystem group')
  assert.equal(calls.length, 0, 'no restriction while nothing is hidden')
})

test('saving hides tools, persists the file, and the next step applies the mask', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read', 'write', 'web_search', 'web_fetch'], calls)
  h.fire('agent/created', { agent })

  const save = await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST',
    body: JSON.stringify({ hidden: ['web_search', 'web_fetch', 'nope'] }),
  }))
  const saved = await save.json()
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.hidden, ['web_fetch', 'web_search'], 'unknown names are dropped')

  const scenario = await h.routes.get('/api/tool-slice/scenario').fetch(new Request(
    'http://localhost/api/tool-slice/scenario',
    { method: 'POST', body: JSON.stringify({ action: 'save', name: '编码', hidden: ['web_search', 'ghost'] }) },
  ))
  const withScenario = await scenario.json()
  assert.equal(withScenario.ok, true)
  assert.deepEqual(withScenario.scenarios, [{ name: '编码', hidden: ['web_search'], note: '' }], 'unknown names are dropped')

  const file = JSON.parse(fs.readFileSync(h.stateFile, 'utf8'))
  assert.deepEqual(file.hidden, ['web_fetch', 'web_search'])
  assert.deepEqual(file.scenarios, [{ name: '编码', hidden: ['web_search'], note: '' }])
  assert.deepEqual(file.sessions, {}, 'a default save writes no session override')

  let nextCalled = false
  h.fire('agent/pre-step', { agent }, () => { nextCalled = true; return Promise.resolve('decision') })
  assert.equal(nextCalled, true, 'the waterfall still asks the next listener')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].filter, { deny: ['web_fetch', 'web_search'] })
})

test('a second save lifts the previous restriction before applying a new one', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read', 'write', 'web_search'], calls)
  h.fire('agent/created', { agent })

  const save = (hidden) => h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST',
    body: JSON.stringify({ hidden }),
  }))

  await (await save(['web_search'])).json()
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  await (await save(['read'])).json()
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))

  assert.deepEqual(calls[0].filter, { deny: ['web_search'] })
  assert.deepEqual(calls[1], { dispose: { deny: ['web_search'] } })
  assert.deepEqual(calls[2].filter, { deny: ['read'] })
})

test('a restriction error falls back to the currently visible names', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read', 'write'], calls)
  const original = agent.ctx.tools.restrict
  let attempts = 0
  agent.ctx.tools.restrict = (filter) => {
    attempts += 1
    if (attempts === 1) throw new Error('tools.restrict() names unknown global tool "legacy"')
    return original(filter)
  }
  h.fire('agent/created', { agent })

  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST',
    body: JSON.stringify({ hidden: ['legacy', 'read'] }),
  }))).json()

  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.equal(attempts, 2, 'retried once with visible names')
  assert.deepEqual(calls[0].filter, { deny: ['read'] })
})

test('a malformed save body is rejected without touching the file', async () => {
  const h = harness()
  const response = await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST',
    body: 'not json',
  }))
  assert.equal(response.status, 400)
  assert.equal(fs.existsSync(h.stateFile), false)
})

test('inventory merges tools seen from several agents', async () => {
  const h = harness()
  h.fire('agent/created', { agent: fakeAgent('s-a', ['read'], []) })
  h.fire('agent/created', { agent: fakeAgent('s-b', ['web_search'], []) })
  const snapshot = await state(h)
  assert.deepEqual(snapshot.tools.map((tool) => tool.name), ['read', 'web_search'])
})

test('the agent/disposed path lifts the restriction', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read', 'web_search'], calls)
  h.fire('agent/created', { agent })
  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST',
    body: JSON.stringify({ hidden: ['web_search'] }),
  }))).json()
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  h.fire('agent/disposed', { agent })
  assert.deepEqual(calls.at(-1), { dispose: { deny: ['web_search'] } })
})

test('a hand-edited state file is adopted at the next step', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read', 'write', 'web_search'], calls)
  h.fire('agent/created', { agent })

  fs.writeFileSync(h.stateFile, JSON.stringify({ version: 1, revision: 1, hidden: ['web_search'], sets: [] }))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.deepEqual(calls.at(-1).filter, { deny: ['web_search'] })

  // Editing the file again swaps the mask without a restart.
  fs.writeFileSync(h.stateFile, JSON.stringify({ version: 1, revision: 1, hidden: ['read'], sets: [] }))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.deepEqual(calls.at(-1).filter, { deny: ['read'] })

  // Back to an empty mask: the restriction is lifted, not narrowed to nothing.
  fs.writeFileSync(h.stateFile, JSON.stringify({ version: 1, revision: 1, hidden: [], sets: [] }))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.equal(calls.at(-1).dispose !== undefined, true, 'empty mask disposes the previous filter')
  assert.equal(calls.filter((call) => call.filter !== undefined).length, 2, 'no third filter registered')
})

test('an unchanged file does not reapply the mask', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read'], calls)
  h.fire('agent/created', { agent })
  fs.writeFileSync(h.stateFile, JSON.stringify({ hidden: ['read'], sets: [] }))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.equal(calls.length, 1, 'one restriction, no churn per step')
})

test('a malformed state file keeps the previous mask and never throws', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-a', ['read'], calls)
  h.fire('agent/created', { agent })
  fs.writeFileSync(h.stateFile, JSON.stringify({ hidden: ['read'], sets: [] }))
  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))

  fs.writeFileSync(h.stateFile, '{ "hidden": [')
  let nextCalled = false
  h.fire('agent/pre-step', { agent }, () => { nextCalled = true; return Promise.resolve('ok') })
  assert.equal(nextCalled, true, 'the step still proceeds')
  assert.deepEqual(calls.at(-1).filter, { deny: ['read'] }, 'previous mask survives')
})

test('the plugin loads with a malformed state file despite the initial read failing', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-slice-host-'))
  fs.writeFileSync(path.join(profile, 'tool-slice.json'), 'not json at all')
  process.env.DSH_PROFILE_DIR = profile
  const ctx = {
    logger: { warn: () => {} },
    on() { return () => {} },
    inject() {},
    effect() { return () => {} },
  }
  assert.doesNotThrow(() => apply(ctx))
})

test('an Agent created before the plugin was enabled is adopted at its next step', async () => {
  const h = harness()
  const calls = []
  // No `agent/created` at all: this Agent predates the plugin activation.
  const agent = fakeAgent('s-old', ['read', 'web_search'], calls)
  fs.writeFileSync(h.stateFile, JSON.stringify({ hidden: ['web_search'], sets: [] }))

  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.deepEqual(calls.at(-1).filter, { deny: ['web_search'] }, 'live Agents get the mask too')
  const snapshot = await state(h)
  assert.equal(snapshot.ready, true, 'the pre-step path also fills the inventory')
})

test('the /slice command is registered with its hint', () => {
  const h = harness()
  const slice = h.commands.get('slice')
  assert.ok(slice, 'slice command exists')
  assert.match(slice.description, /plan-act/)
  assert.match(slice.input.hint, /plan/)
})

test('/slice rejects an unknown argument instead of guessing', async () => {
  const h = harness()
  const result = await h.commands.get('slice').handler({ agent: fakeAgent('s-a', PLAN_ACT_TOOLS, []), rawInput: 'explode' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /不认识的参数/)
})

test('/slice plan asks the model to discuss before decomposing', async () => {
  const h = harness()
  const sent = []
  const agent = {
    ...fakeAgent('s-a', PLAN_ACT_TOOLS, []),
    followup: async (input) => { sent.push(input) },
  }
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'plan 给登录页加验证码' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /先问几个关键问题/)
  assert.equal(sent.length, 1)
  const text = sent[0].content.map((block) => block.text).join('\n')
  assert.match(text, /给登录页加验证码/)
  assert.match(text, /ask_user_question/, 'clarify first')
  assert.match(text, /停下来/, 'stop after planning')
  assert.doesNotMatch(text, /用 step_run 逐步执行/, 'no auto-start instruction')
})

test('/slice revise forwards the feedback with the current goal', async () => {
  const h = harness()
  const sent = []
  const agent = {
    ...fakeAgent('plan2', PLAN_ACT_TOOLS, []),
    followup: async (input) => { sent.push(input) },
  }
  const file = path.join(h.profile, '.dsh', 'plans', 'plan-plan2.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlan({
    goal: '补上登录验证码',
    steps: [{ n: 1, title: '接入验证码', task: '在 login 页加校验', done: '单测通过', status: '待办' }],
  }))

  const result = await h.commands.get('slice').handler({ agent, rawInput: 'revise 拆成 4 步，先补测试' })
  assert.equal(result.kind, 'success')
  assert.equal(sent.length, 1)
  const text = sent[0].content.map((block) => block.text).join('\n')
  assert.match(text, /拆成 4 步，先补测试/)
  assert.match(text, /补上登录验证码/)
  assert.match(text, /已完成的步骤和它们的报告会自动保留/)
  assert.match(text, /不要开始执行/)
})

test('/slice revise works without a plan file yet', async () => {
  const h = harness()
  const sent = []
  const agent = { ...fakeAgent('plan3', PLAN_ACT_TOOLS, []), followup: async (input) => { sent.push(input) } }
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'revise 先别做界面' })
  assert.equal(result.kind, 'success')
  assert.match(sent[0].content[0].text, /先别做界面/)
  assert.doesNotMatch(sent[0].content[0].text, /当前计划的目标：\s*\n/, 'no empty goal line')
})

test('/slice next without a plan explains the next move', async () => {
  const h = harness()
  const agent = fakeAgent('s-a', PLAN_ACT_TOOLS, [])
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'next' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /还没有计划文件/)
})

test('/slice show reports the plan progress and every step', async () => {
  const h = harness()
  const agent = fakeAgent('plan1', [], [])
  const file = path.join(h.profile, '.dsh', 'plans', 'plan-plan1.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlan({
    goal: '补上登录验证码',
    steps: [
      { n: 1, title: '盘点登录入口', task: '读 src/auth', done: '列出清单', status: '完成', record: '找到 2 个入口' },
      { n: 2, title: '接入验证码', task: '在 login 页加校验', done: '单测通过', status: '待办' },
    ],
  }))
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'show' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /1\/2 完成/)
  assert.match(result.text, /接入验证码/)
  const index = JSON.parse(fs.readFileSync(h.planIndexFile, 'utf8'))
  assert.equal(index.sessions.plan1.file, file, 'reading a plan registers it for the dock')
})

test('the plan route serves the dock view and stays empty without a session', async () => {
  const h = harness()
  const route = h.routes.get('/api/tool-slice/plan')
  assert.ok(route, 'plan route registered')
  assert.deepEqual(route.methods, ['GET'])

  const empty = await (await route.fetch(new Request('http://localhost/api/tool-slice/plan?session=nope'))).json()
  assert.equal(empty.ok, true)
  assert.equal(empty.plan, null)
  assert.equal(empty.reason, 'no-plan')

  const file = path.join(h.profile, 'plan.md')
  fs.writeFileSync(file, renderPlan({
    goal: '补上登录验证码',
    steps: [
      { n: 1, title: '盘点登录入口', task: '读 src/auth', done: '列出清单', status: '完成', record: '找到 2 个入口' },
      { n: 2, title: '接入验证码', task: '在 login 页加校验', done: '单测通过', status: '待办' },
    ],
  }))
  fs.writeFileSync(h.planIndexFile, JSON.stringify({
    version: 1,
    sessions: { 's-dock': { file, cwd: h.profile, updatedAt: '2026-11-20T12:00:00Z' } },
  }))

  const served = await (await route.fetch(new Request('http://localhost/api/tool-slice/plan?session=s-dock'))).json()
  assert.equal(served.ok, true)
  assert.equal(served.plan.goal, '补上登录验证码')
  assert.equal(served.plan.done, 1)
  assert.equal(served.plan.current.n, 2)
  assert.equal(served.plan.steps.length, 2)

  const broken = await (await route.fetch(new Request('http://localhost/api/tool-slice/plan?session=gone'))).json()
  assert.equal(broken.plan, null)
})

test('a session save stores its own mask and leaves the default alone', async () => {
  const h = harness()
  const alpha = []
  const beta = []
  h.fire('agent/created', { agent: fakeAgent('s-alpha', ['read', 'web_search', 'pwsh'], alpha) })
  h.fire('agent/created', { agent: fakeAgent('s-beta', ['read', 'web_search', 'pwsh'], beta) })

  const save = (session, body) => h.routes.get('/api/tool-slice/save').fetch(new Request(
    `http://localhost/api/tool-slice/save${session === undefined ? '' : `?session=${session}`}`,
    { method: 'POST', body: JSON.stringify(body) },
  ))

  // The profile default hides pwsh; then alpha hides web tools only.
  await (await save(undefined, { hidden: ['pwsh'] })).json()
  const alphaSaved = await (await save('s-alpha', { hidden: ['web_search'] })).json()
  assert.deepEqual(alphaSaved.hidden, ['web_search'], 'alpha sees its own list')
  assert.equal(alphaSaved.source, 'session')
  assert.equal(alphaSaved.session.override, true)
  assert.deepEqual(alphaSaved.globalHidden, ['pwsh'], 'the default is untouched')

  const bettaState = await (await h.routes.get('/api/tool-slice/state')
    .fetch(new Request('http://localhost/api/tool-slice/state?session=s-beta'))).json()
  assert.deepEqual(bettaState.hidden, ['pwsh'], 'beta still follows the default')
  assert.equal(bettaState.source, 'global')

  h.fire('agent/pre-step', { agent: { ...fakeAgent('s-alpha', ['read', 'web_search', 'pwsh'], alpha) } }, () => Promise.resolve('ok'))
  h.fire('agent/pre-step', { agent: { ...fakeAgent('s-beta', ['read', 'web_search', 'pwsh'], beta) } }, () => Promise.resolve('ok'))
  // The pre-step path re-registers each Agent, so read the latest filters by index.
  assert.deepEqual(alpha.at(-1).filter, { deny: ['web_search'] }, 'alpha applies its own mask')
  assert.deepEqual(beta.at(-1).filter, { deny: ['pwsh'] }, 'beta applies the default')

  const file = JSON.parse(fs.readFileSync(h.stateFile, 'utf8'))
  assert.deepEqual(file.hidden, ['pwsh'])
  assert.deepEqual(file.sessions['s-alpha'].hidden, ['web_search'])
  assert.equal(file.sessions['s-beta'], undefined, 'a session that never saved has no entry')
})

test('followGlobal drops a session override so it tracks the default again', async () => {
  const h = harness()
  const calls = []
  const agent = fakeAgent('s-gamma', ['read', 'web_search'], calls)
  h.fire('agent/created', { agent })
  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST', body: JSON.stringify({ hidden: ['read'] }),
  }))).json()
  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save?session=s-gamma', {
    method: 'POST', body: JSON.stringify({ hidden: ['web_search'] }),
  }))).json()
  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save?session=s-gamma', {
    method: 'POST', body: JSON.stringify({ hidden: ['web_search'], followGlobal: true }),
  }))).json()

  const snapshot = await (await h.routes.get('/api/tool-slice/state')
    .fetch(new Request('http://localhost/api/tool-slice/state?session=s-gamma'))).json()
  assert.deepEqual(snapshot.hidden, ['read'], 'back on the default')
  assert.equal(snapshot.source, 'global')
  assert.equal(snapshot.session.override, false, 'reported as no override')

  h.fire('agent/pre-step', { agent }, () => Promise.resolve('ok'))
  assert.deepEqual(calls.at(-1).filter, { deny: ['read'] })
})

test('a version-1 state file loads with its sets as scenarios', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-slice-host-'))
  process.env.DSH_PROFILE_DIR = profile
  fs.writeFileSync(path.join(profile, 'tool-slice.json'), JSON.stringify({
    version: 1,
    revision: 4,
    hidden: ['web_search'],
    sets: [{ name: '调研', hidden: ['pwsh'] }],
  }))
  const routes = new Map()
  const ctx = {
    logger: { warn: () => {} },
    on: () => () => {},
    inject: (_deps, callback) => callback(ctx),
    effect: (factory) => factory(),
    connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {} } } },
    commands: { register: () => () => {} },
    workingDirectory: { ensure: async () => profile },
  }
  apply(ctx)
  const snapshot = await (await routes.get('/api/tool-slice/state').fetch()).json()
  assert.deepEqual(snapshot.hidden, ['web_search'])
  assert.deepEqual(snapshot.scenarios, [{ name: '调研', hidden: ['pwsh'], note: '' }])
  assert.equal(snapshot.version, 2)
})

test('a scenario can be created, replaced and deleted without touching masks', async () => {
  const h = harness()
  const calls = []
  h.fire('agent/created', { agent: fakeAgent('s-a', ['read', 'web_search', 'pwsh'], calls) })
  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST', body: JSON.stringify({ hidden: ['pwsh'] }),
  }))).json()

  const scenario = (body) => h.routes.get('/api/tool-slice/scenario').fetch(new Request(
    'http://localhost/api/tool-slice/scenario',
    { method: 'POST', body: JSON.stringify(body) },
  ))

  const created = await (await scenario({ action: 'save', name: '调研', hidden: ['pwsh'] })).json()
  assert.deepEqual(created.scenarios.map((item) => item.name), ['调研'])
  assert.deepEqual(created.hidden, ['pwsh'], 'the default mask is untouched')

  const replaced = await (await scenario({ action: 'save', name: '调研', hidden: ['web_search', 'pwsh'] })).json()
  assert.equal(replaced.scenarios.length, 1, 'the same name replaces rather than duplicates')
  assert.deepEqual(replaced.scenarios[0].hidden, ['pwsh', 'web_search'])

  const bad = await scenario({ action: 'save', name: '   ', hidden: ['pwsh'] })
  assert.equal(bad.status, 400)

  const deleted = await (await scenario({ action: 'delete', name: '调研' })).json()
  assert.deepEqual(deleted.scenarios, [])
  const file = JSON.parse(fs.readFileSync(h.stateFile, 'utf8'))
  assert.deepEqual(file.scenarios, [])
  assert.deepEqual(file.hidden, ['pwsh'])
})

test('a scenario save returns the session view of the caller', async () => {
  const h = harness()
  h.fire('agent/created', { agent: fakeAgent('s-own', ['read', 'web_search'], []) })
  await (await h.routes.get('/api/tool-slice/save').fetch(new Request('http://localhost/api/tool-slice/save?session=s-own', {
    method: 'POST', body: JSON.stringify({ hidden: ['read'] }),
  }))).json()

  const response = await h.routes.get('/api/tool-slice/scenario').fetch(new Request(
    'http://localhost/api/tool-slice/scenario?session=s-own',
    { method: 'POST', body: JSON.stringify({ action: 'save', name: '编码', hidden: ['web_search'] }) },
  ))
  const snapshot = await response.json()
  assert.deepEqual(snapshot.scenarios.map((item) => item.name), ['编码'])
  assert.deepEqual(snapshot.hidden, ['read'], 'still this session\'s own mask')
  assert.equal(snapshot.session.override, true)
})

test('the snapshot offers built-in scenarios derived from the real groups', async () => {
  const h = harness()
  h.fire('agent/created', { agent: fakeAgent('s-a', ['read', 'web_search', 'pwsh', 'office_render'], []) })
  const snapshot = await state(h)
  const names = snapshot.builtInScenarios.map((scenario) => scenario.name)
  assert.deepEqual(names, ['编码', '调研', '极简'])
  const coding = snapshot.builtInScenarios.find((scenario) => scenario.name === '编码')
  assert.ok(coding.hidden.includes('web_search'), 'coding hides web tools')
  assert.ok(coding.hidden.includes('office_render'), 'coding hides Office')
  assert.ok(!coding.hidden.includes('read'), 'coding keeps the filesystem')
  const research = snapshot.builtInScenarios.find((scenario) => scenario.name === '调研')
  assert.ok(research.hidden.includes('pwsh'), 'research hides the terminal')
  assert.ok(!research.hidden.includes('web_search'), 'research keeps web tools')
  const minimal = snapshot.builtInScenarios.find((scenario) => scenario.name === '极简')
  assert.ok(minimal.hidden.includes('pwsh') && minimal.hidden.includes('web_search'))
  assert.ok(!minimal.hidden.includes('read'))
})

test('/api/tool-slice/approve confirms a plan with no Agent running', async () => {
  const h = harness()
  const file = seedPlan(h, 's-a')
  assert.equal(parsePlan(fs.readFileSync(file, 'utf8')).approvedAt, '')

  const response = await post(h, '/api/tool-slice/approve', 's-a', { approved: true })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.plan.approved, true)
  assert.notEqual(parsePlan(fs.readFileSync(file, 'utf8')).approvedAt, '', 'the file is the source of truth')

  const off = await (await post(h, '/api/tool-slice/approve', 's-a', { approved: false })).json()
  assert.equal(off.plan.approved, false)
  assert.equal(parsePlan(fs.readFileSync(file, 'utf8')).approvedAt, '')
})

test('/api/tool-slice/approve refuses a session with no plan', async () => {
  const h = harness()
  const response = await post(h, '/api/tool-slice/approve', 's-none', { approved: true })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /还没有计划/)
})

test('/api/tool-slice/step writes one step model and tool policy', async () => {
  const h = harness()
  const file = seedPlan(h, 's-a')

  const response = await post(h, '/api/tool-slice/step', 's-a', {
    step: 1, model: 'local/Qwen3.8-9B-Q6_K', hidden: ['web_search', 'web_search', 'web_fetch'],
  })
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.plan.steps[0].model, 'local/Qwen3.8-9B-Q6_K')
  assert.deepEqual(body.plan.steps[0].hidden, ['web_fetch', 'web_search'])
  assert.equal(body.plan.steps[1].model, '', 'other steps are untouched')

  const parsed = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.equal(parsed.steps[0].model, 'local/Qwen3.8-9B-Q6_K')
  assert.deepEqual(parsed.steps[0].hidden, ['web_fetch', 'web_search'])
  assert.equal(parsed.approvedAt, '', 'editing a step does not silently confirm the plan')
})

test('/api/tool-slice/step rejects a bad step number', async () => {
  const h = harness()
  seedPlan(h, 's-a')
  const missing = await post(h, '/api/tool-slice/step', 's-a', { step: 9, model: 'x/y' })
  assert.equal(missing.status, 400)
  assert.match((await missing.json()).error, /没有第 9 步/)

  const invalid = await post(h, '/api/tool-slice/step', 's-a', { step: 0, model: 'x/y' })
  assert.equal(invalid.status, 400)
  assert.match((await invalid.json()).error, /步骤号无效/)
})

test('/api/tool-slice/models answers even with no LLM service', async () => {
  const h = harness()
  const response = await h.routes.get('/api/tool-slice/models').fetch()
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.routes, [], 'the picker falls back to "inherit"')
})

test('/slice approve gates the model-facing step_run', async () => {
  const h = harness()
  const file = seedPlan(h, 's-a')
  const agent = { ...fakeAgent('s-a', PLAN_ACT_TOOLS, []), followup: async () => {} }

  const result = await h.commands.get('slice').handler({ agent, rawInput: 'approve' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /已确认/)
  assert.notEqual(parsePlan(fs.readFileSync(file, 'utf8')).approvedAt, '')

  const off = await h.commands.get('slice').handler({ agent, rawInput: 'unapprove' })
  assert.equal(off.kind, 'success')
  assert.match(off.text, /取消确认/)
  assert.equal(parsePlan(fs.readFileSync(file, 'utf8')).approvedAt, '')
})

test('/slice approve without a plan reports the missing plan', async () => {
  const h = harness()
  const agent = { ...fakeAgent('s-none', ['read'], []), followup: async () => {} }
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'approve' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /还没有计划文件/)
})
test('a session without the plan-act tools is told why, instead of silently doing nothing', async () => {
  const h = harness()
  // A standard-preset session: the dock is mounted profile-wide, but the preset
  // owns plan_write/step_run, so these commands have nothing behind them.
  const agent = { ...fakeAgent('s-std', ['read', 'write', 'subagent'], []), followup: async () => {} }

  for (const line of ['plan 修图', 'next', 'revise 改成 4 步']) {
    const result = await h.commands.get('slice').handler({ agent, rawInput: line })
    assert.equal(result.kind, 'error', `${line} must refuse`)
    assert.match(result.text, /没有 plan-act 的计划工具/)
    assert.match(result.text, /plan_write/, 'it names what is missing')
    assert.match(result.text, /新开一个预设选 plan-act 的会话/, 'and what to do instead')
  }
})

test('a plan-act session is not blocked by that guard', async () => {
  const h = harness()
  const sent = []
  const agent = { ...fakeAgent('s-plan', PLAN_ACT_TOOLS, []), followup: async (input) => { sent.push(input) } }
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'plan 修图' })
  assert.equal(result.kind, 'success')
  assert.equal(sent.length, 1)
})
test('/slice parallel starts only the steps whose dependencies are met', async () => {
  const h = harness()
  const agent = { ...fakeAgent('s-par5', PLAN_ACT_TOOLS, []), followup: async () => {} }
  const file = path.join(h.profile, '.dsh', 'plans', 'plan-s-par5.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlan({
    goal: '并行',
    approvedAt: '2026-11-21 00:00',
    steps: [
      { n: 1, title: '甲', task: '独立一', status: '待办' },
      { n: 2, title: '乙', task: '独立二', status: '待办' },
      { n: 3, title: '丙', task: '依赖甲', status: '待办', dependsOn: [1] },
    ],
  }))
  touchPlanIndex(agent, h.profile, file)

  const result = await h.commands.get('slice').handler({ agent, rawInput: 'parallel' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /并行跑了 2 步/, 'the dependent step did not start')
  assert.deepEqual(h.spawns.map((spec) => spec.label).sort(), ['step 1', 'step 2'])
})

test('/slice stop says plainly when nothing is running', async () => {
  const h = harness()
  const agent = fakeAgent('s-par6', PLAN_ACT_TOOLS, [])
  const result = await h.commands.get('slice').handler({ agent, rawInput: 'stop' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /没有在执行的步骤可停止/)
})
test('the profile default policy is saved once and served back with the plan', async () => {
  const h = harness()
  const save = h.routes.get('/api/tool-slice/save')
  const response = await save.fetch(new Request('http://localhost/api/tool-slice/save', {
    method: 'POST',
    body: JSON.stringify({ defaults: true, access: '只读' }),
  }))
  assert.equal(response.status, 200)
  const saved = JSON.parse(fs.readFileSync(h.stateFile, 'utf8'))
  assert.deepEqual(saved.planDefaults, { access: '只读', hidden: [] }, 'the default survives the save')

  const agent = fakeAgent('s-dflt99', PLAN_ACT_TOOLS, [])
  const file = path.join(h.profile, '.dsh', 'plans', 'plan-s-dflt99.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlan({
    goal: 'g',
    steps: [{ n: 1, title: '甲', task: 'x', status: '待办' }],
  }))
  touchPlanIndex(agent, h.profile, file)

  const plan = h.routes.get('/api/tool-slice/plan')
  const snapshot = await (await plan.fetch(new Request(`http://localhost/api/tool-slice/plan?session=${encodeURIComponent('s-dflt99')}`))).json()
  assert.deepEqual(snapshot.plan.defaults, { access: '只读', hidden: [] }, 'the panel can show the default')
  assert.equal(snapshot.plan.running, false)
  assert.deepEqual(snapshot.plan.stats, {}, 'no steps have run, so no cost counters yet')
})
test('/slice auto only starts when the plan is approved and has ready work', async () => {
  const h = harness()
  const sent = []
  const agent = { ...fakeAgent('s-auto77', PLAN_ACT_TOOLS, []), followup: async (input) => { sent.push(input) } }
  const file = path.join(h.profile, '.dsh', 'plans', 'plan-s-auto77.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlan({
    goal: '自动跑',
    approvedAt: '',
    steps: [{ n: 1, title: '甲', task: 'a', status: '待办' }],
  }))
  touchPlanIndex(agent, h.profile, file)

  const refused = await h.commands.get('slice').handler({ agent, rawInput: 'auto' })
  assert.equal(refused.kind, 'error')
  assert.match(refused.text, /还没确认/)
  assert.equal(sent.length, 0, 'an unconfirmed plan never starts the model')

  // Confirm through the same route the panel uses, then ask again.
  const approve = h.routes.get('/api/tool-slice/approve')
  await approve.fetch(new Request('http://localhost/api/tool-slice/approve?session=s-auto77', {
    method: 'POST',
    body: JSON.stringify({ approved: true }),
  }))
  const started = await h.commands.get('slice').handler({ agent, rawInput: 'auto' })
  assert.equal(started.kind, 'success')
  assert.equal(sent.length, 1)
  assert.match(sent[0].content[0].text, /自动顺次执行/)
  assert.match(started.text, /自动顺次执行/)
})