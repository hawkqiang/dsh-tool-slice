import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS, renderPlan, parsePlan, nextStep, pickStep, progressLine,
  sliceForStep, clampReport, groupTools, estimateTokens, normalizeHidden,
  planView, parseSliceCommand, mergePlanIndex, mergePlan,
  resolveHidden, normalizeScenarios, builtInScenarios, groupOfTool, scenarioOf,
} from '../core.mjs'

const sample = {
  goal: '把登录页从 session 换成 JWT，并补上刷新逻辑',
  session: 's-abc123',
  createdAt: '2026-11-20 20:00',
  steps: [
    { n: 1, title: '梳理现有登录链路', task: '读 src/auth/*，列出所有签发与校验点', done: '列出清单', status: STATUS.done, record: '找到 4 处签发点：login.ts, refresh.ts, middleware.ts, test/auth.ts' },
    { n: 2, title: '实现 JWT 签发', task: '在 login 路由签 access+refresh', done: '单元测试通过', status: STATUS.todo },
    { n: 3, title: '校验中间件', task: '替换 session 校验', done: '集成测试通过', status: STATUS.todo },
  ],
}

test('render then parse round-trips goal, steps, task and records', () => {
  const markdown = renderPlan(sample)
  assert.match(markdown, /^# 任务：把登录页/)
  assert.match(markdown, /进度：1\/3 完成/)
  assert.match(markdown, /### 1\. 梳理现有登录链路 —— 完成/)
  const parsed = parsePlan(markdown)
  assert.equal(parsed.goal, sample.goal)
  assert.equal(parsed.steps.length, 3)
  assert.equal(parsed.steps[0].status, '完成')
  assert.equal(parsed.steps[0].task, '读 src/auth/*，列出所有签发与校验点')
  assert.equal(parsed.steps[0].done, '列出清单')
  assert.match(parsed.steps[0].record, /找到 4 处签发点/)
  assert.equal(parsed.steps[1].record, '')
})

test('re-rendering a parsed plan is stable', () => {
  const first = renderPlan(sample)
  const second = renderPlan(parsePlan(first))
  assert.equal(second, first)
})

test('nextStep and pickStep follow status', () => {
  const parsed = parsePlan(renderPlan(sample))
  assert.equal(nextStep(parsed).n, 2)
  assert.equal(pickStep(parsed, 3).step.n, 3)
  assert.equal(pickStep(parsed, 99).error, '没有第 99 步')
  const done = parsePlan(renderPlan({ goal: 'g', steps: [{ n: 1, title: 't', task: 'x', status: STATUS.done }] }))
  assert.equal(pickStep(done, undefined).error, '所有步骤都已完成')
})

test('progressLine reports the current step', () => {
  const parsed = parsePlan(renderPlan(sample))
  assert.equal(progressLine(parsed), '1/3 完成（当前第 2 步）')
})

test('sliceForStep keeps only this step, its criteria and recent results', () => {
  const parsed = parsePlan(renderPlan(sample))
  const slice = sliceForStep(parsed, parsed.steps[1])
  assert.match(slice, /总目标：把登录页/)
  assert.match(slice, /本步：第 2\/3 步/)
  assert.match(slice, /做什么：在 login 路由签 access\+refresh/)
  assert.match(slice, /完成标准：单元测试通过/)
  assert.match(slice, /第 1 步：找到 4 处签发点/)
  assert.doesNotMatch(slice, /校验中间件/)
})

test('sliceForStep is bounded', () => {
  const long = parsePlan(renderPlan({
    goal: 'x'.repeat(5000),
    steps: [{ n: 1, title: 't', task: 'y'.repeat(9000), status: STATUS.todo }],
  }))
  const slice = sliceForStep(long, long.steps[0], { maxChars: 600 })
  assert.ok(slice.length <= 600, `slice length ${slice.length}`)
  assert.match(slice, /已截断/)
})

test('clampReport bounds a long report', () => {
  const text = clampReport('a'.repeat(5000), 300)
  assert.ok(text.length <= 300)
  assert.match(text, /已截断/)
})

test('groupTools folds filesystem tools and splits the rest by prefix', () => {
  const groups = groupTools([
    { name: 'read', tokens: 300 },
    { name: 'write', tokens: 200 },
    { name: 'grep', tokens: 120 },
    { name: 'web_search', tokens: 400 },
    { name: 'web_fetch', tokens: 300 },
  ])
  const byGroup = Object.fromEntries(groups.map((entry) => [entry.group, entry]))
  assert.deepEqual(byGroup.fs.tools.map((tool) => tool.name), ['read', 'write'])
  assert.equal(byGroup.fs.label, '文件读写')
  assert.equal(byGroup.fs.tokens, 500)
  assert.equal(byGroup.fs_search.tokens, 120)
  assert.equal(byGroup.web.tokens, 700)
  assert.equal(groups[0].group, 'web')
})

test('estimateTokens is monotonic and positive', () => {
  assert.ok(estimateTokens(0) >= 8)
  assert.ok(estimateTokens(3500) > estimateTokens(350))
})

test('normalizeHidden drops unknown names and duplicates', () => {
  const known = new Set(['read', 'web_search'])
  assert.deepEqual(normalizeHidden(['web_search', 'web_search', 'nope', 3], known), ['web_search'])
  assert.deepEqual(normalizeHidden('nope', known), [])
})

test('planView is the compact shape the dock renders', () => {
  const view = planView(sample, { file: '/w/.dsh/plans/plan-abc.md' })
  assert.equal(view.total, 3)
  assert.equal(view.done, 1)
  assert.equal(view.failed, 0)
  assert.equal(view.current.n, 2)
  assert.equal(view.current.title, '实现 JWT 签发')
  assert.equal(view.progress, '1/3 完成（当前第 2 步）')
  assert.equal(view.file, '/w/.dsh/plans/plan-abc.md')
  assert.deepEqual(view.steps.map((step) => step.status), ['完成', '待办', '待办'])
  assert.ok(view.steps[0].task.length <= 240, 'long text is trimmed for the browser')
  assert.ok(!('record' in view.steps[1]) || view.steps[1].record === '')
})

test('planView tolerates a missing plan', () => {
  const view = planView(undefined)
  assert.equal(view.total, 0)
  assert.equal(view.current, null)
  assert.deepEqual(view.steps, [])
})

test('/slice grammar covers the dock buttons and rejects unknown arguments', () => {
  assert.deepEqual(parseSliceCommand(''), { action: 'show' })
  assert.deepEqual(parseSliceCommand('show'), { action: 'show' })
  assert.deepEqual(parseSliceCommand('next'), { action: 'next' })
  assert.deepEqual(parseSliceCommand('next 3'), { action: 'next', step: 3 })
  assert.deepEqual(parseSliceCommand('step 2'), { action: 'next', step: 2 })
  assert.deepEqual(parseSliceCommand('plan 给登录页加验证码'), { action: 'plan', goal: '给登录页加验证码' })
  const unknown = parseSliceCommand('drop everything')
  assert.equal(unknown.action, 'show')
  assert.match(unknown.error, /不认识的参数/)
  assert.equal(parseSliceCommand('next 0').error !== undefined, true)
})

test('mergePlanIndex keeps the newest sessions and replaces one', () => {
  const first = mergePlanIndex(undefined, 's-a', { file: '/a.md', cwd: '/', updatedAt: '2026-11-20T10:00:00Z' })
  assert.deepEqual(Object.keys(first.sessions), ['s-a'])
  const second = mergePlanIndex(first, 's-b', { file: '/b.md', cwd: '/', updatedAt: '2026-11-20T11:00:00Z' })
  assert.deepEqual(Object.keys(second.sessions).sort(), ['s-a', 's-b'])
  const replaced = mergePlanIndex(second, 's-a', { file: '/a2.md', cwd: '/', updatedAt: '2026-11-20T12:00:00Z' })
  assert.equal(replaced.sessions['s-a'].file, '/a2.md')
  assert.equal(Object.keys(replaced.sessions).length, 2)
  assert.equal(mergePlanIndex({ junk: true }, 's-c', { file: '/c.md', cwd: '/', updatedAt: 'x' }).sessions['s-c'].file, '/c.md')
})

test('mergePlan keeps finished steps and their reports across a rewrite', () => {
  const previous = parsePlan(renderPlan(sample))
  const { plan, kept, revision } = mergePlan(previous, {
    goal: '把登录页从 session 换成 JWT，并补上刷新逻辑',
    steps: [
      { title: '梳理现有登录链路', task: '读 src/auth/*，列出所有签发与校验点', done: '列出清单' },
      { title: '实现 JWT 签发', task: '在 login 路由签 access+refresh，并写入 cookie', done: '单元测试通过' },
      { title: '校验中间件', task: '替换 session 校验', done: '集成测试通过' },
    ],
  })
  assert.equal(revision, 2)
  assert.equal(plan.revision, 2)
  assert.match(plan.revisedAt, /^\d{4}-\d{2}-\d{2}/)
  assert.equal(kept, 1)
  assert.equal(plan.steps[0].status, STATUS.done)
  assert.match(plan.steps[0].record, /找到 4 处签发点/, 'the finished report survives the rewrite')
  assert.equal(plan.steps[1].status, STATUS.todo, 'a pending step stays pending')
  assert.equal(plan.steps[1].task, '在 login 路由签 access+refresh，并写入 cookie', 'the new wording wins')
})

test('mergePlan appends finished steps a rewrite dropped instead of deleting them', () => {
  const previous = parsePlan(renderPlan(sample))
  const { plan, appended } = mergePlan(previous, {
    goal: '只做签发那一步',
    steps: [{ title: '实现 JWT 签发', task: '在 login 路由签 access+refresh' }],
  })
  assert.equal(appended, 1)
  assert.equal(plan.steps.length, 2)
  assert.equal(plan.steps[1].title, '梳理现有登录链路')
  assert.equal(plan.steps[1].status, STATUS.done)
  assert.match(plan.steps[1].record, /找到 4 处签发点/)
  assert.equal(plan.steps[0].status, STATUS.todo, 'a rewritten single step starts fresh')
})

test('a revised plan round-trips through Markdown', () => {
  const previous = parsePlan(renderPlan(sample))
  const { plan } = mergePlan(previous, {
    goal: '把登录页从 session 换成 JWT，并补上刷新逻辑',
    steps: [{ title: '实现 JWT 签发', task: '签 access+refresh' }],
  })
  const markdown = renderPlan(plan)
  assert.match(markdown, /- 修订：.*（第 2 版）/)
  const parsed = parsePlan(markdown)
  assert.equal(parsed.revision, 2)
  assert.equal(parsed.revisedAt, plan.revisedAt)
  assert.equal(renderPlan(parsed), markdown, 're-rendering a parsed revision is stable')
})

test('/slice understands revise', () => {
  assert.deepEqual(parseSliceCommand('revise 第 3 步太笼统'), { action: 'revise', feedback: '第 3 步太笼统' })
  assert.deepEqual(parseSliceCommand('修订 只要 4 步'), { action: 'revise', feedback: '只要 4 步' })
  assert.equal(parseSliceCommand('revise').action, 'revise')
  assert.match(parseSliceCommand('revise').error, /用法/)
})

test('resolveHidden prefers a session mask and falls back to the default', () => {
  const state = { hidden: ['pwsh'], sessions: { 's-a': { hidden: ['web_search'] } } }
  assert.deepEqual(resolveHidden(state, 's-a'), { hidden: ['web_search'], source: 'session' })
  assert.deepEqual(resolveHidden(state, 's-b'), { hidden: ['pwsh'], source: 'global' })
  assert.deepEqual(resolveHidden(state, ''), { hidden: ['pwsh'], source: 'global' })
  assert.deepEqual(resolveHidden({ hidden: ['x'] }, 's-a'), { hidden: ['x'], source: 'global' })
})

test('normalizeScenarios dedupes names, caps lengths and keeps notes', () => {
  const scenarios = normalizeScenarios([
    { name: ' 编码 ', hidden: ['b', 'a', 'a'], note: '只读代码' },
    { name: '编码', hidden: ['b'] },
    { name: '', hidden: ['x'] },
    { name: '调研', hidden: ['pwsh'], note: 'x'.repeat(400) },
  ], new Set(['a', 'b', 'pwsh']))
  assert.deepEqual(scenarios.map((scenario) => scenario.name), ['编码', '调研'])
  assert.deepEqual(scenarios[0].hidden, ['a', 'b'])
  assert.equal(scenarios[0].note, '只读代码')
  assert.equal(scenarios[1].note.length, 160)
  assert.deepEqual(normalizeScenarios('nope', undefined), [])
})

test('builtInScenarios hides by group, not by hard-coded tool names', () => {
  const tools = ['read', 'write', 'glob', 'pwsh', 'web_search', 'office_render', 'todo_write', 'subagent_start']
    .map((name) => ({ name }))
  const scenarios = builtInScenarios(tools)
  assert.deepEqual(scenarios.map((scenario) => scenario.name), ['编码', '调研', '极简'])
  const byName = Object.fromEntries(scenarios.map((scenario) => [scenario.name, scenario.hidden]))
  assert.deepEqual(byName['编码'], ['office_render', 'web_search'])
  assert.deepEqual(byName['调研'], ['office_render', 'pwsh'])
  assert.ok(byName['极简'].includes('office_render') && byName['极简'].includes('pwsh'))
  assert.ok(!byName['极简'].includes('read') && !byName['极简'].includes('todo_write'))
  assert.deepEqual(groupOfTool('read'), 'fs')
  assert.deepEqual(groupOfTool('glob'), 'fs_search')
  assert.deepEqual(groupOfTool('web_fetch'), 'web')
})

test('scenarioOf names the scheme the switch list currently equals', () => {
  const scenarios = [
    { name: '编码', hidden: ['web_search', 'office_render'] },
    { name: '调研', hidden: ['pwsh'] },
  ]
  assert.equal(scenarioOf(scenarios, new Set(['office_render', 'web_search'])), '编码', 'order does not matter')
  assert.equal(scenarioOf(scenarios, ['pwsh']), '调研')
  assert.equal(scenarioOf(scenarios, ['read']), '', 'a hand-tuned list has no scenario')
  assert.equal(scenarioOf(undefined, ['read']), '')
  assert.equal(scenarioOf([], []), '')
})
