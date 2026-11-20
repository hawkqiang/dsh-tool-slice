import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStepTools } from '../step-tools.js'
import { parsePlan } from '../core.mjs'

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
  return path.join(cwd, '.dsh', 'plans', 'plan-test1234.md')
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
  assert.match(text, /调用 step_run/)
  const parsed = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.equal(parsed.goal, planArgs.goal)
  assert.deepEqual(parsed.steps.map((step) => step.title), ['盘点签发点', '实现签发', '替换校验'])
  assert.equal(parsed.steps[0].status, '待办')
})

test('step_run spawns a caller-delivered child and returns only the next slice', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd)
  const [planWrite, stepRun] = createStepTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })

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
  const [planWrite, stepRun] = createStepTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })

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
  const [planWrite, stepRun] = createStepTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })

  const text = await stepRun.execute({}, { agent, signal })
  assert.match(text, /第 1 步失败/)
  assert.match(text, /模型超时/)
  const parsed = parsePlan(fs.readFileSync(planPath(cwd), 'utf8'))
  assert.equal(parsed.steps[0].status, '失败')
})

test('a startup failure is reported instead of thrown', async () => {
  const cwd = workspace()
  const ctx = fakeContext(cwd, new Error('ACTIVATION_LIMIT_REACHED'))
  const [planWrite, stepRun] = createStepTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })

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
  const [planWrite, stepRun] = createStepTools(bare)
  await planWrite.execute(planArgs, { agent, signal })
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
  const [planWrite, stepRun] = createStepTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
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
  const [planWrite, stepRun] = createStepTools(ctx)
  await planWrite.execute(planArgs, { agent, signal })
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
