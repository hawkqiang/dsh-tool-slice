import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStepTools } from '../step-tools.js'
import { parsePlan, renderPlan, nextStep } from '../core.mjs'
import {
  setApproved, configureIndexedStep, approveIndexedPlan, watchStepChildren, reserveStepTools, stepDenyList, reserveChildActivity, resetStepActivity, activityOf, stepStatsOf, autoPrompt, mirrorPlanToTodos,
  isRunning, stopSession,
} from '../workflow.mjs'

// The plan index is written beside the profile state file; keep the real
// profile out of the test run.
process.env.DSH_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-slice-profile-'))

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tool-slice-'))
}

function fakeContext(cwd, reply = { stopReason: 'completed', output: [{ type: 'text', text: '改了 a.ts，测试通过' }] }) {
  const spawns = []
  return {
    spawns,
    workingDirectory: { ensure: async () => cwd },
    subagents: {
      startActivation: async (spec) => {
        spawns.push(spec)
        const response = typeof reply === 'function' ? reply(spec) : reply
        if (response instanceof Error) throw response
        return { result: Promise.resolve(response) }
      },
    },
  }
}

const agent = { session: { id: 's-test1234' } }
const signal = new AbortController().signal

function planPath(cwd) {
  return planPathFor(cwd, 's-test1234')
}

function planPathFor(cwd, sessionId) {
  return path.join(cwd, '.dsh', 'plans', `plan-${sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(-8)}.md`)
}

const planArgs = {
  goal: '把登录从 session 换成 JWT 并补刷新',
  steps: [
    { title: '盘点签发点', task: '读 src/auth，列出所有签发与校验点', done: '给出清单' },
    { title: '实现签发', task: '在 login 路由签 access+refresh', done: '单测通过' },
    { title: '替换校验', task: '中间件改用 JWT 校验', done: '集成测试通过' },
  ],
}

test('plan_write writes a readable Markdown plan', async () => {
  const cwd = workspace()
  const [planWrite] = createStepTools(fakeContext(cwd))
  const text = await planWrite.execute(planArgs, { agent, signal })

  const file = planPath(cwd)
  assert.ok(fs.existsSync(file), 'plan file exists')
  assert.match(text, /共 3 步/)
  assert.match(text, /step_run/)
  assert.match(text, /确认/)
  const parsed = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.equal(parsed.goal, planArgs.goal)
  assert.deepEqual(parsed.steps.map((step) => step.title), ['盘点签发点', '实现签发', '替换校验'])
  assert.equal(parsed.steps[0].status, '待办')
})

test('step_run spawns a caller-delivered child and returns only the next slice', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)

  const text = await stepRun.execute({}, { agent, signal })
  assert.equal(ctx.spawns.length, 1)
  const spawn = ctx.spawns[0]
  assert.equal(spawn.provider, 'spawn')
  assert.equal(spawn.delivery, 'caller')
  assert.equal(spawn.parent, agent)
  assert.equal(spawn.label, 'step 1')
  const prompt = spawn.prompt.map((block) => block.text).join('\n')
  assert.match(prompt, /把登录从 session 换成 JWT/)
  assert.match(prompt, /盘点签发点/)
  assert.match(prompt, /src\/auth/)
  assert.doesNotMatch(prompt, /中间件改用 JWT 校验/, 'the child must not receive later steps')

  assert.match(text, /第 1\/3 步完成/)
  assert.match(text, /改了 a\.ts，测试通过/)
  assert.match(text, /下一步 · 第 2 步/)
  assert.match(text, /在 login 路由签 access\+refresh/)

  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.steps[0].status, '完成')
  assert.match(parsed.steps[0].record, /改了 a\.ts/)
})

test('running every step ends with a summary instruction and a finished plan', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd, (spec) => ({
    stopReason: 'completed',
    output: [{ type: 'text', text: `${spec.label} 完成，改了 src/a.ts` }],
  }))
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)

  await stepRun.execute({}, { agent, signal })
  await stepRun.execute({}, { agent, signal })
  const last = await stepRun.execute({}, { agent, signal })

  assert.equal(ctx.spawns.length, 3)
  assert.match(last, /全部 3 步已完成/)
  assert.match(last, /向用户总结/)

  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.deepEqual(parsed.steps.map((step) => step.status), ['完成', '完成', '完成'])

  const again = await stepRun.execute({}, { agent, signal })
  assert.match(again, /无需执行/)

  const rerun = await stepRun.execute({ step: 2 }, { agent, signal })
  assert.match(rerun, /第 2\/3 步完成/)
})

test('a failed child marks the step failed and does not claim completion', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd, { stopReason: 'error', output: [], diagnostic: '模型超时' })
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)

  const text = await stepRun.execute({}, { agent, signal })
  assert.match(text, /第 1 步失败/)
  assert.match(text, /模型超时/)
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.steps[0].status, '失败')
})

test('a startup failure is reported instead of thrown', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd, new Error('ACTIVATION_LIMIT_REACHED'))
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)

  const text = await stepRun.execute({}, { agent, signal })
  assert.match(text, /第 1 步失败/)
  assert.match(text, /ACTIVATION_LIMIT_REACHED/)
})

test('step_run without a plan tells the model to plan first', async () => {
  const cwd = workspace()
  const [, stepRun] = createStepTools(fakeContext(cwd))
  await assert.rejects(() => stepRun.execute({}, { agent, signal }), /先调用 plan_write/)
})

test('plan_write rejects empty input', async () => {
  const cwd = workspace()
  const [planWrite] = createStepTools(fakeContext(cwd))
  await assert.rejects(() => planWrite.execute({ goal: '', steps: [] }, { agent, signal }), /非空/)
  await assert.rejects(() => planWrite.execute({ goal: 'x', steps: [{ title: 'a', task: '' }] }, { agent, signal }), /非空/)
})

test('a composition without delegation loads and reports the missing service', async () => {
  const cwd = workspace()
  const bare = { workingDirectory: { ensure: async () => cwd } }
  const [planWrite, stepRun] = createTextTools(bare)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(bare, agent, true)
  const text = await stepRun.execute({}, { agent, signal })
  assert.match(text, /第 1 步失败/)
  assert.match(text, /没有启用子代理委派/)
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.steps[0].status, '失败')
})

test('no working-directory provider falls back to the process directory', async () => {
  const [planWrite] = createStepTools({})
  const text = await planWrite.execute(planArgs, { agent, signal })
  assert.match(text, /计划已写入/)
  assert.ok(fs.existsSync(path.join(process.cwd(), '.dsh', 'plans', 'plan-test1234.md')))
  fs.rmSync(path.join(process.cwd(), '.dsh'), { recursive: true, force: true })
})

test('plan_write stops and asks for confirmation instead of starting work', async () => {
  const cwd = workspace()
  const [planWrite] = createStepTools(fakeContext(cwd))
  const text = await planWrite.execute(planArgs, { agent, signal })
  assert.match(text, /第 1 版/)
  assert.match(text, /现在停下来/)
  assert.match(text, /等用户确认/)
  assert.match(text, /\[待办\] 盘点签发点/)
  assert.doesNotMatch(text, /下一步：调用 step_run/, 'the old auto-start hint is gone')
})

test('a revised plan_write keeps the reports of finished steps', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd, {
    stopReason: 'completed',
    output: [{ type: 'text', text: '找到 4 处签发点：login.ts / refresh.ts / middleware.ts / test/auth.ts' }],
  })
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)
  await stepRun.execute({}, { agent, signal })

  const revised = await planWrite.execute({
    goal: planArgs.goal,
    steps: [
      { title: '盘点签发点', task: '读 src/auth，列出所有签发与校验点', done: '给出清单' },
      { title: '实现签发与刷新', task: '在 login 路由签 access+refresh 并写 cookie', done: '单测通过' },
    ],
  }, { agent, signal })

  assert.match(revised, /第 2 版/)
  assert.match(revised, /已保留 1 个已完成步骤/)
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.steps[0].status, '完成')
  assert.match(parsed.steps[0].record, /找到 4 处签发点/, 'the child report survived the revision')
  assert.deepEqual(parsed.steps.map((step) => step.title), ['盘点签发点', '实现签发与刷新'])
  assert.equal(parsed.revision, 2)
})

test('a revision that drops a finished step keeps it at the end', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd, { stopReason: 'completed', output: [{ type: 'text', text: '清单见上' }] })
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)
  await stepRun.execute({}, { agent, signal })

  const revised = await planWrite.execute({
    goal: '只做签发',
    steps: [{ title: '实现签发', task: '签 access+refresh' }],
  }, { agent, signal })
  assert.match(revised, /追加到计划末尾/)

  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.deepEqual(parsed.steps.map((step) => step.title), ['实现签发', '盘点签发点'])
  assert.equal(parsed.steps[1].status, '完成')
  assert.match(parsed.steps[1].record, /清单见上/)
  assert.equal(parsed.steps[0].status, '待办')
})

test('step_run refuses a plan the human has not confirmed', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })

  await assert.rejects(() => stepRun.execute({}, { agent, signal }), /还没确认/)
  assert.equal(ctx.spawns.length, 0, 'no child is created before confirmation')
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.approvedAt, '', 'the plan stays unconfirmed')
  assert.equal(parsed.steps[0].status, '待办', 'the refused step is not marked running')
})

test('confirming lets it run, and a rewrite withdraws the confirmation again', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)
  await stepRun.execute({}, { agent, signal })
  assert.equal(ctx.spawns.length, 1)

  await planWrite.execute(planArgs, { agent, signal })
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.approvedAt, '', 'a revision must be confirmed again')
  await assert.rejects(() => stepRun.execute({}, { agent, signal }), /还没确认/)
  assert.equal(ctx.spawns.length, 1, 'the second attempt started nothing')
})

test('a step runs with the model and tool policy the panel set for it', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })

  // What the dock writes when the user picks a model and unchecks tools.
  configureIndexedStep('s-test1234', { step: 1, model: 'local/Qwen3.8-9B-Q6_K', hidden: ['web_search', 'web_fetch'] })
  await setApproved(ctx, agent, true)

  const text = await stepRun.execute({}, { agent, signal })
  const spawn = ctx.spawns[0]
  assert.deepEqual(spawn.agentOptions, { provider: 'local', model: 'Qwen3.8-9B-Q6_K' }, 'the chosen model drives the child')
  assert.ok(typeof spawn.childId === 'string' && spawn.childId.length > 0, 'the child id is reserved before creation')
  assert.match(text, /模型：local\/Qwen3\.8-9B-Q6_K/)
  assert.match(text, /权限：自定义（关闭 2 个工具）/)

  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.steps[0].model, 'local/Qwen3.8-9B-Q6_K')
  assert.deepEqual(parsed.steps[0].hidden, ['web_fetch', 'web_search'])
  assert.equal(parsed.steps[1].model, '', 'other steps keep inheriting')
})

test('a reserved step policy is applied to its child and then consumed', () => {
  const listeners = []
  const watcher = { on: (event, handler, options) => { listeners.push({ event, handler, options }); return () => {} } }
  watchStepChildren(watcher)
  // Two global listeners: one applies the step's tool policy at creation, the
  // other feeds the child's committed events into that step's activity log.
  assert.equal(listeners.length, 2)
  assert.equal(listeners[0].event, 'agent/created')
  assert.deepEqual(listeners[0].options, { global: true }, 'the child of any session must be seen')
  assert.equal(listeners[1].event, 'session/event')
  assert.deepEqual(listeners[1].options, { global: true }, 'a child of any session narrates itself')

  reserveStepTools('child-abc', ['web_search', 'never-mounted'])
  const restrictions = []
  const child = {
    session: { id: 'child-abc' },
    ctx: {
      tools: {
        definitions: () => [{ name: 'web_search' }, { name: 'read' }],
        restrict: (filter) => { restrictions.push(filter); return () => {} },
      },
      effect: (register) => { register() },
    },
  }
  listeners[0].handler({ agent: child })
  // A name the child never mounted would fail the whole filter, so it is dropped.
  assert.deepEqual(restrictions, [{ deny: ['web_search'] }])

  // The policy is one-shot: a later agent with the same id gets nothing.
  listeners[0].handler({ agent: child })
  assert.equal(restrictions.length, 1)
})

test('the panel can confirm a plan with no Agent running', async () => {
  const cwd = workspace()
  const [planWrite] = createStepTools(fakeContext(cwd))
  await planWrite.execute(planArgs, { agent, signal })
  assert.equal(parsePlan(fs.readFileSync(planPath(cwd), 'utf8')).approvedAt, '')

  const approved = approveIndexedPlan('s-test1234', true)
  assert.equal(approved.plan.steps.length, 3)
  assert.notEqual(parsePlan(fs.readFileSync(planPath(cwd), 'utf8')).approvedAt, '')

  const withdrawn = approveIndexedPlan('s-test1234', false)
  assert.equal(withdrawn.plan.approvedAt, '')
  assert.equal(parsePlan(fs.readFileSync(planPath(cwd), 'utf8')).approvedAt, '')
})

test('a step started without a caller signal still spawns (the panel has none)', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)

  // Exactly what /slice next and the panel button do: no signal to forward.
  const text = await stepRun.execute({}, { agent })
  assert.equal(ctx.spawns.length, 1)
  const forwarded = ctx.spawns[0].signal
  assert.equal(typeof forwarded?.throwIfAborted, 'function', 'the delegation manager dereferences this signal')
  assert.equal(forwarded.aborted, false)
  assert.match(text, /第 1\/3 步完成/)
})

test('a failed step stays next until it is retried or skipped on purpose', async () => {
  const cwd = workspace()
  const own = { session: { id: 's-failed9' } }
  const file = planPathFor(cwd, 's-failed9')
  const ctx = fakeContext(cwd, { stopReason: 'error', output: [], diagnostic: '模型超时' })
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent: own, signal })
  await setApproved(ctx, own, true)

  // A failure does not silently advance to the next step: the plan keeps
  // offering the step that is actually unfinished.
  await stepRun.execute({}, { agent: own, signal })
  const retried = await stepRun.execute({}, { agent: own, signal })
  assert.match(retried, /第 1 步失败/)
  assert.equal(ctx.spawns.length, 2, 'the same step was retried, not skipped')
  let parsed = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(parsed.steps.map((step) => step.status), ['失败', '待办', '待办'])

  // Addressing a step explicitly still works, so a block can be worked around.
  await stepRun.execute({ step: 2 }, { agent: own, signal })
  await stepRun.execute({ step: 3 }, { agent: own, signal })
  parsed = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(parsed.steps.map((step) => step.status), ['失败', '失败', '失败'])

  // With everything failed the plan must still offer work, not claim success.
  const again = await stepRun.execute({}, { agent: own, signal })
  assert.match(again, /第 1 步失败/)
  assert.doesNotMatch(again, /全部 3 步已完成/)
  assert.equal(ctx.spawns.length, 5)
})

test('parallel runs every independent step at once and honours dependencies', async () => {
  const cwd = workspace()
  const own = { session: { id: 's-parallel' } }
  const file = planPathFor(cwd, 's-parallel')
  const spawned = []
  const ctx = {
    workingDirectory: { ensure: async () => cwd },
    subagents: {
      startActivation: async (spec) => {
        spawned.push(spec.label)
        return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: `${spec.label} 完成` }] }) }
      },
    },
  }
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute({
    goal: '并行',
    steps: [
      { title: '甲', task: '独立任务一' },
      { title: '乙', task: '独立任务二' },
      { title: '丙', task: '依赖甲', dependsOn: [1] },
    ],
  }, { agent: own, signal })
  await setApproved(ctx, own, true)

  const text = await stepRun.execute({ parallel: true }, { agent: own, signal })
  // 丙 depends on 甲, which is running in the same batch, so only 甲 and 乙 start.
  assert.deepEqual([...spawned].sort(), ['step 1', 'step 2'])
  assert.match(text, /并行跑了 2 步/)
  assert.match(text, /计划状态/)
  assert.match(text, /1\. \[完成\] 甲/)
  assert.match(text, /3\. \[待办\] 丙/)

  // 甲 is now finished, so 丙 becomes ready.
  const after = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(after.steps.map((step) => step.status), ['完成', '完成', '待办'])
  await stepRun.execute({}, { agent: own, signal })
  assert.deepEqual([...spawned].sort(), ['step 1', 'step 2', 'step 3'])
})

test('stopping a session cancels its running steps as 已取消', async () => {
  const cwd = workspace()
  const own = { session: { id: 's-stop5678' } }
  const file = planPathFor(cwd, 's-stop5678')
  const ctx = {
    workingDirectory: { ensure: async () => cwd },
    subagents: {
      startActivation: async (spec) => ({
        result: new Promise((resolve) => {
          spec.signal.addEventListener('abort', () => resolve({ stopReason: 'aborted', output: [] }), { once: true })
        }),
      }),
    },
  }
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent: own, signal })
  await setApproved(ctx, own, true)

  const running = stepRun.execute({}, { agent: own, signal })
  for (let attempt = 0; attempt < 50 && !isRunning('s-stop5678'); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  assert.equal(isRunning('s-stop5678'), true, 'the run is registered for the session')
  assert.equal(stopSession('s-stop5678'), true)

  const text = await running
  assert.equal(isRunning('s-stop5678'), false, 'the registry is cleared when it settles')
  assert.match(text, /已停止/)
  assert.match(text, /第 1 步已取消/)
  const parsed = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.equal(parsed.steps[0].status, '已取消')

  // A cancelled step is runnable again: "继续" is just the next run.
  assert.notEqual(nextStep(parsed), undefined)
})
test('plan_write records each step model and permission profile', async () => {
  const cwd = workspace()
  const [planWrite] = createStepTools(fakeContext(cwd))
  const text = await planWrite.execute({
    goal: '修 K 线图',
    steps: [
      { title: '盘点脚本', task: '读 candles.py', done: '列出函数', model: 'local/Qwen3.8-9B-Q6_K', access: '只读' },
      { title: '重做图一', task: '改 复权与K线图详解.py', done: '审计通过', model: 'qiafan/glm-5.3-flash', access: '读写' },
    ],
  }, { agent, signal })

  assert.match(text, /模型 local\/Qwen3\.8-9B-Q6_K · 权限 只读/)
  assert.match(text, /模型 qiafan\/glm-5\.3-flash · 权限 读写/)
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.deepEqual(parsed.steps.map((step) => [step.model, step.access]), [
    ['local/Qwen3.8-9B-Q6_K', '只读'],
    ['qiafan/glm-5.3-flash', '读写'],
  ])
})

test('a step runs with the permission profile it declares', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute({
    goal: '只读排查',
    steps: [{ title: '盘点', task: '读文件', done: '清单', access: '只读' }],
  }, { agent, signal })
  await setApproved(ctx, agent, true)

  const text = await stepRun.execute({}, { agent, signal })
  assert.match(text, /权限：只读/)
  // The profile becomes a deny list against the tools this preset mounts.
  assert.ok(stepDenyList({ access: '只读' }, agent).length >= 0)
  assert.deepEqual(stepDenyList({ access: '全量' }, agent), [])
  assert.deepEqual(stepDenyList({ hidden: ['web_search'], access: '只读' }, agent), ['web_search'], 'a granular list wins')
})

test('plan_options lists the curated models and the three profiles', async () => {
  const cwd = workspace()
  const ctx = {
    ...fakeContext(cwd),
    llm: {
      listProviders: () => [{ id: 'local', name: '本地' }],
      listModels: async () => [{ id: 'Qwen3.8-9B-Q6_K', name: 'Qwen3.8-9B-Q6_K' }],
    },
    // What the profile's subagent model-selection setting exposes at runtime.
    subagentModelSelection: {
      config: { allowedModels: { get: () => [{ provider: 'qiafan', model: 'glm-5.3-flash' }] } },
    },
  }
  const tools = createTextTools(ctx)
  const options = tools.find((tool) => tool.name === 'plan_options')
  assert.ok(options, 'plan_options is registered')
  const text = await options.execute({}, { agent, signal })
  assert.match(text, /qiafan\/glm-5\.3-flash/, 'the curated route is offered')
  assert.doesNotMatch(text, /local\/Qwen3\.8-9B-Q6_K/, 'the curated list replaces the raw enumeration')
  for (const profile of ['只读', '读写', '全量']) assert.match(text, new RegExp(`- ${profile}：`))
})
test('a running step records which model and permission it runs with, before the report exists', async () => {
  const cwd = workspace()
  const during = {}
  const ctx = {
    workingDirectory: { ensure: async () => cwd },
    subagents: {
      startActivation: async () => {
        // Read the plan at the moment the child starts: this is exactly what
        // the dock shows while the user waits.
        during.plan = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
        return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '做完了' }] }) }
      },
    },
  }
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute({
    goal: '修图',
    steps: [{ title: '盘点', task: '读脚本', done: '清单', model: 'qiafan/glm-5.3-flash', access: '只读' }],
  }, { agent, signal })
  await setApproved(ctx, agent, true)
  await stepRun.execute({}, { agent, signal })

  assert.equal(during.plan.steps[0].status, '进行中')
  assert.notEqual(during.plan.steps[0].startedAt, '', 'the start time is written before the child runs')
  assert.equal(during.plan.steps[0].model, 'qiafan/glm-5.3-flash')
  assert.equal(during.plan.steps[0].access, '只读')

  const after = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(after.steps[0].status, '完成')
  assert.equal(after.steps[0].startedAt, '', 'a finished step is not left looking live')
})

test('a step left running by an interrupted turn is picked again by the next run', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
  await setApproved(ctx, agent, true)

  // Simulate a crash mid-step: the file says running, nothing is executing.
  const file = planPath(cwd)
  const crashed = parsePlan(fs.readFileSync(file, 'utf8'))
  crashed.steps[0] = { ...crashed.steps[0], status: '进行中', startedAt: '2026-11-21 00:51' }
  fs.writeFileSync(file, renderPlan(crashed))

  const text = await stepRun.execute({}, { agent, signal })
  assert.equal(ctx.spawns.length, 1, 'the stale step is retried instead of being skipped')
  assert.match(text, /第 1\/3 步完成/)
})
test('a running step narrates its child’s tool calls and results as they commit', () => {
  const listeners = []
  const watcher = { on: (event, handler) => { listeners.push({ event, handler }); return () => {} } }
  watchStepChildren(watcher)
  reserveChildActivity('child-log', { parent: 's-log1234', step: 2 })
  resetStepActivity('s-log1234', 2)

  const child = {
    session: { id: 'child-log' },
    ctx: { tools: { definitions: () => [], restrict: () => () => {} }, effect: () => {} },
  }
  listeners[0].handler({ agent: child })
  const session = { id: 'child-log' }
  listeners[1].handler(session, { type: 'tool/call', data: { name: 'read', arguments: '{"path":"a.ts"}' } })
  listeners[1].handler(session, { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'file body' }] } } })
  listeners[1].handler(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '读完了，接着改' }] } } })
  // A session that is not a step child must not be narrated.
  listeners[1].handler({ id: 'someone-else' }, { type: 'tool/call', data: { name: 'write', arguments: '{}' } })

  const lines = activityOf('s-log1234')['2']
  assert.equal(lines[0], '— 子代理已启动')
  assert.deepEqual(lines.slice(1), [
    '🔧 read({"path":"a.ts"})',
    '✓ file body',
    '💬 读完了，接着改',
  ])
  assert.deepEqual(activityOf('s-nobody'), {}, 'an unrelated session has no activity')
})

test('a step without a policy inherits the profile default policy', async () => {
  const cwd = workspace()
  const profile = process.env.DSH_PROFILE_DIR
  const stateFile = path.join(profile, 'tool-slice.json')
  fs.writeFileSync(stateFile, JSON.stringify({ planDefaults: { access: '只读', hidden: [] } }))
  try {
    const own = { session: { id: 's-dflt1234' } }
    const ctx = fakeContext(cwd)
    const [planWrite] = createTextTools(ctx)
    await planWrite.execute({
      goal: '只读排查',
      steps: [{ title: '盘点', task: '读脚本' }, { title: '改代码', task: '写文件', access: '读写' }],
    }, { agent: own, signal })

    const parsed = parsePlan(fs.readFileSync(planPathFor(cwd, 's-dflt1234'), 'utf8'))
    assert.equal(parsed.steps[0].access, '只读', 'the default fills an unset step')
    assert.equal(parsed.steps[1].access, '读写', 'an explicit step keeps its own policy')
  } finally {
    fs.writeFileSync(stateFile, JSON.stringify({ planDefaults: { access: '', hidden: [] } }))
  }
})
test('the automatic prompt keeps the model going and still stops on failure', () => {
  const text = autoPrompt({ goal: 'g', steps: [
    { n: 1, title: '甲', task: 'a', status: '完成' },
    { n: 2, title: '乙', task: 'b', status: '待办' },
  ] })
  assert.match(text, /自动顺次执行/)
  assert.match(text, /从第 2 步开始/, 'it names where to continue')
  assert.match(text, /不要停下来问我/)
  assert.match(text, /某一步失败/)
  assert.match(text, /停止全部/, 'the human stop still wins')
})

test('step usage is reported as tokens and tokens per second', () => {
  const listeners = []
  const watcher = { on: (event, handler) => { listeners.push({ event, handler }); return () => {} } }
  watchStepChildren(watcher)
  reserveChildActivity('child-cost', { parent: 's-cost1234', step: 1 })
  resetStepActivity('s-cost1234', 1)
  const child = { session: { id: 'child-cost' }, ctx: { tools: { definitions: () => [], restrict: () => () => {} }, effect: () => {} } }
  listeners[0].handler({ agent: child })
  const session = { id: 'child-cost' }
  listeners[1].handler(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'ok' }] }, usage: { inputTokens: 120, outputTokens: 300 } } })
  listeners[1].handler(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'again' }] }, usage: { inputTokens: 80, outputTokens: 100 } } })

  const stats = stepStatsOf('s-cost1234')['1']
  assert.equal(stats.calls, 2)
  assert.equal(stats.input, 200)
  assert.equal(stats.output, 400)
  assert.ok(stats.ms >= 0)
  assert.equal(typeof stats.tps, 'number')
  assert.deepEqual(stepStatsOf('s-nobody'), {})
})
test('step_run carries the child trail into the conversation, bounded by characters', async () => {
  const cwd = workspace()
  const own = { session: { id: 's-split12' } }
  const ctx = fakeContext(cwd)
  const tools = rawStepTools(ctx)
  const run = tools.find((tool) => tool.name === 'step_run')

  // What the conversation renders: the compact report plus a capped trail block.
  const forUi = run.projectContent({}, { value: { text: '精简报告', n: 1, log: ['🔧 read()', '✓ ok'] } })
  assert.equal(forUi[0].text, '精简报告')
  assert.match(forUi[1].text, /## 第 1 步 · 子代理全过程/)
  assert.match(forUi[1].text, /🔧 read\(\)/)
  // A long trail is bounded by characters (the preset pruner threshold), and it
  // keeps far more than a teaser: the whole step, not the last few lines.
  const long = run.projectContent({}, { value: { text: 't', n: 1, log: Array.from({ length: 40 }, (_, i) => `line ${i}`) } })
  assert.match(long[1].text, /line 0/, 'the beginning of the step is kept')
  assert.match(long[1].text, /line 39/, 'and so is its end')
  const huge = run.projectContent({}, { value: { text: 't', n: 1, log: Array.from({ length: 200 }, () => 'x'.repeat(60)) } })
  assert.ok(huge[1].text.length <= 4200, 'the result stays under the pruner threshold')
  assert.match(huge[1].text, /已截断/)
  // Without a trail there is only the report, never an empty fence.
  assert.deepEqual(run.projectContent({}, { value: { text: 'x', log: [] } }), [{ type: 'text', text: 'x' }])

  // What the transcript card shows: the step number and the whole trail.
  const meta = run.output.presentationMeta({}, { text: 't', n: 3, log: ['🔧 read()', '✓ ok'] })
  assert.deepEqual(meta, { n: 3, log: '🔧 read()\n✓ ok' })
  const card = run.presentResult({}, { meta, content: [], isError: false })
  assert.equal(card.card, 'generic')
  assert.match(card.title, /第 3 步/)
  assert.equal(card.content[0].text, '🔧 read()\n✓ ok')
  // Without a log the card still has a title instead of an empty body.
  assert.match(run.presentResult({}, { meta: { n: 2, log: '' }, content: [{ type: 'text', text: 'x' }] }).title, /第 2 步/)
  assert.match(run.presentCall({ step: 4 }).title, /第 4 步/)

  // A real run carries the step number into the returned value.
  const [planWrite] = tools
  await planWrite.execute(planArgs, { agent: own, signal })
  await setApproved(ctx, own, true)
  const value = await run.execute({}, { agent: own, signal })
  assert.equal(value.n, 1, 'the report is parsed back into a step number')
  assert.ok(Array.isArray(value.log))
  assert.match(value.text, /第 1\/3 步完成/)
})
/**
 * `step_run` returns `{ text, n, log }` so the transcript card can carry the
 * child's whole trail; most assertions only care about the model-facing text.
 */
function textOf(value) {
  return typeof value === 'string' ? value : String(value?.text ?? '')
}

function rawStepTools(ctx) {
  return createStepTools(ctx)
}

function createTextTools(ctx) {
  const tools = createStepTools(ctx)
  const run = tools.find((tool) => tool.name === 'step_run')
  return [
    tools[0],
    { ...run, execute: async (args, exec) => textOf(await run.execute(args, exec)) },
    ...tools.slice(2),
  ]
}
test('the plan is mirrored into the conversation todo card', async () => {
  const cwd = workspace()
  const events = []
  const own = { session: { id: 's-todo123', append: (type, data) => { events.push({ type, data }) } } }
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createTextTools(ctx)
  await planWrite.execute(planArgs, { agent: own, signal })

  // Planning alone shows the checklist in the big conversation.
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'todo/write')
  assert.deepEqual(events[0].data.todos.map((todo) => todo.status), ['pending', 'pending', 'pending'])
  assert.match(events[0].data.todos[0].content, /^1\. /)

  await setApproved(ctx, own, true)
  await stepRun.execute({}, { agent: own, signal })
  // One event when the step starts, one when it settles.
  const last = events[events.length - 1]
  assert.deepEqual(last.data.todos.map((todo) => todo.status), ['completed', 'pending', 'pending'])
  const running = events[events.length - 2]
  assert.deepEqual(running.data.todos.map((todo) => todo.status), ['in_progress', 'pending', 'pending'])

  // A session that cannot take the event must not break the run.
  assert.equal(mirrorPlanToTodos({ session: {} }, { steps: [{ n: 1, title: 'x' }] }), false)
  assert.equal(mirrorPlanToTodos(undefined, { steps: [{ n: 1, title: 'x' }] }), false)
  assert.equal(mirrorPlanToTodos(own, { steps: [] }), false)
})