/**
 * Pure helpers for the tool-slice bundle: the Markdown plan format, the
 * per-step slice fed to a child agent, tool grouping, and token estimates.
 * No Cordis, no Node I/O — this module is unit-tested on its own.
 */

/** Step status words, used verbatim in the plan Markdown. */
export const STATUS = Object.freeze({
  todo: '待办',
  doing: '进行中',
  done: '完成',
  failed: '失败',
})

const STEP_HEADING = /^### (\d+)\.\s+(.+?)\s+——\s+(待办|进行中|完成|失败)\s*$/
const RECORD_HEADING = /^### 步骤 (\d+)\s+——\s+(待办|进行中|完成|失败)\s*$/
const GOAL_LINE = /^#\s*任务[：:]\s*(.*)$/

/**
 * Render the whole plan document.
 * @param {{goal: string, session?: string, createdAt?: string, steps: Array<{n?: number, title: string, task: string, done?: string, status?: string, record?: string}>}} plan
 * @returns {string} Markdown
 */
export function renderPlan(plan) {
  const steps = plan.steps ?? []
  const finished = steps.filter((step) => step.status === STATUS.done).length
  const lines = [
    `# 任务：${oneLine(plan.goal, 200)}`,
    '',
    `- 会话：${oneLine(plan.session ?? '-', 40)}`,
    `- 创建：${oneLine(plan.createdAt ?? '-', 40)}`,
    `- 进度：${finished}/${steps.length} 完成`,
  ]
  if (plan.revisedAt !== undefined && plan.revisedAt !== '') {
    lines.push(`- 修订：${oneLine(plan.revisedAt, 40)}（第 ${Number(plan.revision ?? 2)} 版）`)
  }
  lines.push('', '## 步骤', '')
  steps.forEach((step, index) => {
    const n = step.n ?? index + 1
    lines.push(`### ${n}. ${oneLine(step.title, 120)} —— ${step.status ?? STATUS.todo}`)
    lines.push(`做什么：${oneLine(step.task, 4000)}`)
    if (step.done !== undefined && step.done !== '') lines.push(`完成标准：${oneLine(step.done, 2000)}`)
    lines.push('')
  })
  const recorded = steps.filter((step) => typeof step.record === 'string' && step.record !== '')
  lines.push('## 记录', '')
  if (recorded.length === 0) {
    lines.push('（尚无记录）', '')
  } else {
    for (const step of recorded) {
      const n = step.n ?? steps.indexOf(step) + 1
      lines.push(`### 步骤 ${n} —— ${step.status ?? STATUS.done}`)
      lines.push('', String(step.record).trim(), '')
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

/**
 * Parse a plan document written by {@link renderPlan}. Lenient: unknown lines
 * are ignored so a hand-edited file still yields usable steps.
 * @param {string} markdown
 * @returns {{goal: string, steps: Array<{n: number, title: string, task: string, done: string, status: string, record: string}>}}
 */
export function parsePlan(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  let goal = ''
  let session
  let createdAt
  let revisedAt
  let revision
  const steps = []
  let section = 'head'
  let current = undefined
  let recordLines = undefined
  for (const raw of lines) {
    const line = raw.trimEnd()
    const goalMatch = GOAL_LINE.exec(line.trim())
    if (section === 'head' && goalMatch) {
      goal = goalMatch[1].trim()
      continue
    }
    if (section === 'head') {
      const sessionMatch = /^-\s*会话[：:]\s*(.*)$/.exec(line.trim())
      if (sessionMatch) {
        if (sessionMatch[1].trim() !== '-') session = sessionMatch[1].trim()
        continue
      }
      const createdMatch = /^-\s*创建[：:]\s*(.*)$/.exec(line.trim())
      if (createdMatch) {
        if (createdMatch[1].trim() !== '-') createdAt = createdMatch[1].trim()
        continue
      }
      const revisedMatch = /^-\s*修订[：:]\s*(.*)$/.exec(line.trim())
      if (revisedMatch) {
        const value = revisedMatch[1].trim()
        if (value !== '-') {
          const version = /（第\s*(\d+)\s*版）\s*$/.exec(value)
          revisedAt = version === null ? value : value.slice(0, version.index).trim()
          if (version !== null) revision = Number(version[1])
        }
        continue
      }
    }
    if (/^##\s*步骤\s*$/.test(line)) {
      section = 'steps'
      current = undefined
      continue
    }
    if (/^##\s*记录\s*$/.test(line)) {
      section = 'records'
      current = undefined
      continue
    }
    if (section === 'steps') {
      const stepMatch = STEP_HEADING.exec(line)
      if (stepMatch) {
        current = {
          n: Number(stepMatch[1]),
          title: stepMatch[2].trim(),
          task: '',
          done: '',
          status: stepMatch[3],
          record: '',
        }
        steps.push(current)
        continue
      }
      if (current !== undefined) {
        const taskMatch = /^做什么[：:]\s*(.*)$/.exec(line.trim())
        if (taskMatch) {
          current.task = taskMatch[1].trim()
          continue
        }
        const doneMatch = /^完成标准[：:]\s*(.*)$/.exec(line.trim())
        if (doneMatch) {
          current.done = doneMatch[1].trim()
          continue
        }
      }
      continue
    }
    if (section === 'records') {
      const recordMatch = RECORD_HEADING.exec(line)
      if (recordMatch) {
        const n = Number(recordMatch[1])
        let target = steps.find((step) => step.n === n)
        if (target === undefined) {
          target = { n, title: `步骤 ${n}`, task: '', done: '', status: recordMatch[2], record: '' }
          steps.push(target)
        }
        target.status = recordMatch[2]
        recordLines = []
        target.__recordLines = recordLines
        continue
      }
      if (recordLines !== undefined) recordLines.push(line)
    }
  }
  for (const step of steps) {
    if (step.__recordLines !== undefined) {
      step.record = step.__recordLines.join('\n').trim()
      delete step.__recordLines
    }
  }
  steps.sort((a, b) => a.n - b.n)
  return {
    goal,
    ...(session !== undefined ? { session } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(revisedAt !== undefined ? { revisedAt } : {}),
    ...(revision !== undefined ? { revision } : {}),
    steps,
  }
}

/**
 * Fold a newly proposed plan into the plan already on disk.
 *
 * A plan is a discussion, so the model rewrites the whole document whenever the
 * user changes their mind. Finished steps are the expensive part — each one
 * carries a child agent's report — so a rewrite matches them by title and keeps
 * their status and record. Completed steps the new plan dropped are appended at
 * the end instead of disappearing, which is why rewriting never destroys work
 * that actually happened.
 *
 * @param {{goal?: string, createdAt?: string, revisedAt?: string, revision?: number, steps?: Array<object>} | undefined} previous
 * @param {{goal: string, steps: Array<{title: string, task: string, done?: string}>}} incoming
 * @returns {{plan: object, kept: number, appended: number, revision: number}}
 */
export function mergePlan(previous, incoming) {
  const oldSteps = Array.isArray(previous?.steps) ? previous.steps : []
  const byTitle = new Map()
  for (const step of oldSteps) {
    const key = titleKey(step.title)
    if (key !== '' && !byTitle.has(key)) byTitle.set(key, step)
  }
  const kept = new Set()
  const steps = (incoming.steps ?? []).map((step, index) => {
    const match = byTitle.get(titleKey(step.title))
    const carried = match !== undefined && match.status === STATUS.done
      ? { status: STATUS.done, record: String(match.record ?? '') }
      : { status: STATUS.todo, record: '' }
    if (match !== undefined) kept.add(match)
    return {
      n: index + 1,
      title: oneLine(step.title, 120) || `步骤 ${index + 1}`,
      task: oneLine(step.task, 4000),
      done: oneLine(step.done ?? '', 2000),
      ...carried,
    }
  })
  const appended = oldSteps.filter((step) => !kept.has(step) && step.status === STATUS.done)
  for (const step of appended) {
    steps.push({
      n: steps.length + 1,
      title: oneLine(step.title, 120),
      task: oneLine(step.task ?? '', 4000),
      done: oneLine(step.done ?? '', 2000),
      status: STATUS.done,
      record: String(step.record ?? ''),
    })
  }
  const revision = previous === undefined || previous.steps === undefined
    ? 1
    : Number(previous.revision ?? 1) + 1
  return {
    plan: {
      goal: oneLine(incoming.goal, 200),
      ...(previous?.session !== undefined ? { session: previous.session } : {}),
      createdAt: previous?.createdAt ?? new Date().toISOString().slice(0, 16).replace('T', ' '),
      ...(revision > 1 ? { revisedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), revision } : { revision: 1 }),
      steps,
    },
    kept: steps.filter((step) => step.status === STATUS.done).length,
    appended: appended.length,
    revision,
  }
}

function titleKey(title) {
  return String(title ?? '').replace(/\s+/g, '').replace(/（已归档）/g, '')
}

/**
 * The next step that is not finished yet.
 * @param {{steps: Array<{n: number, status: string}>}} plan
 * @returns {object | undefined}
 */
export function nextStep(plan) {
  return (plan.steps ?? []).find((step) => step.status !== STATUS.done && step.status !== STATUS.failed)
}

/**
 * One step addressed by number, falling back to the next unfinished step.
 * @param {{steps: Array<object>}} plan
 * @param {number | undefined} n
 * @returns {{step: object | undefined, error?: string}}
 */
export function pickStep(plan, n) {
  if (n === undefined || n === null) {
    const step = nextStep(plan)
    return step === undefined ? { step: undefined, error: '所有步骤都已完成' } : { step }
  }
  const step = (plan.steps ?? []).find((candidate) => candidate.n === n)
  return step === undefined ? { step: undefined, error: `没有第 ${n} 步` } : { step }
}

/**
 * Short progress line such as `3/7 完成（当前第 4 步）`.
 * @param {{steps: Array<object>}} plan
 * @returns {string}
 */
export function progressLine(plan) {
  const steps = plan.steps ?? []
  const finished = steps.filter((step) => step.status === STATUS.done).length
  const next = nextStep(plan)
  return next === undefined
    ? `${finished}/${steps.length} 完成（全部结束）`
    : `${finished}/${steps.length} 完成（当前第 ${next.n} 步）`
}

/**
 * The bounded slice a worker receives for one step: the goal, this step's own
 * definition, recent results, and never the whole conversation or whole plan.
 * @param {{goal: string, steps: Array<object>}} plan
 * @param {object} step
 * @param {{maxChars?: number, history?: number}} [options]
 * @returns {string}
 */
export function sliceForStep(plan, step, options = {}) {
  const maxChars = options.maxChars ?? 2400
  const history = options.history ?? 3
  const steps = plan.steps ?? []
  const earlier = steps.filter((candidate) => candidate.n < step.n && candidate.record !== '')
  const recent = earlier.slice(-history)
  const parts = []
  parts.push(`总目标：${oneLine(plan.goal, 400)}`)
  parts.push('')
  parts.push(`本步：第 ${step.n}/${steps.length} 步 —— ${oneLine(step.title, 120)}`)
  parts.push(`做什么：${oneLine(step.task, 1600)}`)
  if (step.done !== '') parts.push(`完成标准：${oneLine(step.done, 800)}`)
  if (recent.length > 0) {
    parts.push('')
    parts.push('此前各步结果（摘要）：')
    for (const done of recent) parts.push(`- 第 ${done.n} 步：${oneLine(lastLines(done.record, 3), 300)}`)
  }
  return clamp(parts.join('\n'), maxChars)
}

/**
 * Trim a child report to a bounded size for the parent's context.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string}
 */
export function clampReport(text, maxChars = 1400) {
  return clamp(String(text ?? '').trim(), maxChars)
}

/**
 * The compact plan shape the composer dock renders: counts, the current step,
 * and one short row per step. Long task and record text is trimmed here, so the
 * browser never receives the whole plan document.
 * @param {{goal?: string, steps?: Array<object>}} plan
 * @param {{file?: string, updatedAt?: string, mtime?: number}} [extra]
 * @returns {object}
 */
export function planView(plan, extra = {}) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : []
  const done = steps.filter((step) => step.status === STATUS.done).length
  const failed = steps.filter((step) => step.status === STATUS.failed).length
  const next = nextStep({ steps })
  return {
    goal: oneLine(plan?.goal ?? '', 200),
    total: steps.length,
    done,
    failed,
    revision: Number(plan?.revision ?? 1),
    revisedAt: oneLine(plan?.revisedAt ?? '', 40),
    progress: progressLine({ steps }),
    current: next === undefined
      ? null
      : { n: next.n, title: oneLine(next.title, 120), task: oneLine(next.task, 300) },
    steps: steps.map((step) => ({
      n: step.n,
      title: oneLine(step.title, 120),
      status: step.status ?? STATUS.todo,
      task: oneLine(step.task, 240),
      done: oneLine(step.done ?? '', 160),
      record: oneLine(step.record ?? '', 400),
    })),
    ...extra,
  }
}

/**
 * Grammar of the `/slice` command. Kept next to the plan format so the dock
 * buttons, the slash command, and the tests agree on one spelling.
 * @param {string} rawInput text after `slice`
 * @returns {{action: 'show' | 'next' | 'plan' | 'revise', step?: number, goal?: string, feedback?: string, error?: string}}
 */
export function parseSliceCommand(rawInput) {
  const text = String(rawInput ?? '').trim()
  if (text === '' || text === 'show' || text === 'status' || text === '进度') return { action: 'show' }
  const step = /^(?:next|run|step|执行)\s*(\d*)$/.exec(text)
  if (step !== null) {
    if (step[1] === '') return { action: 'next' }
    const n = Number(step[1])
    if (!Number.isInteger(n) || n < 1) return { action: 'next', error: `步骤号无效：${step[1]}` }
    return { action: 'next', step: n }
  }
  const revise = /^(?:revise|改|修订)\s+([\s\S]+)$/.exec(text)
  if (revise !== null) {
    const feedback = revise[1].trim().slice(0, 2000)
    return feedback === ''
      ? { action: 'revise', error: '用法：/slice revise <修改意见>' }
      : { action: 'revise', feedback }
  }
  if (text === 'revise' || text === '修订') {
    return { action: 'revise', error: '用法：/slice revise <修改意见>' }
  }
  const plan = /^(?:plan|new|build|拆解)\s+([\s\S]+)$/.exec(text)
  if (plan !== null) {
    const goal = plan[1].trim().slice(0, 400)
    return goal === '' ? { action: 'plan', error: '用法：/slice plan <目标>' } : { action: 'plan', goal }
  }
  return {
    action: 'show',
    error: `不认识的参数：${oneLine(text, 60)}；用法：/slice [plan <目标> | revise <意见> | next [步骤号] | show]`,
  }
}

/**
 * Merge one session's plan location into the small index the Host serves the
 * dock from, keeping the newest entries only.
 * @param {unknown} index previous file contents
 * @param {string} sessionId
 * @param {{file: string, cwd: string, updatedAt: string}} entry
 * @param {number} [limit]
 * @returns {{version: number, sessions: Record<string, object>}}
 */
export function mergePlanIndex(index, sessionId, entry, limit = 40) {
  const key = String(sessionId ?? '').trim()
  const previous = index !== null && typeof index === 'object' && index.sessions !== null && typeof index.sessions === 'object'
    ? index.sessions
    : {}
  const sessions = {}
  if (key !== '') sessions[key] = { ...entry }
  const rest = Object.entries(previous)
    .filter(([name, value]) => name !== key && value !== null && typeof value === 'object')
    .sort((a, b) => String(b[1].updatedAt ?? '').localeCompare(String(a[1].updatedAt ?? '')))
  for (const [name, value] of rest) {
    if (Object.keys(sessions).length >= limit) break
    sessions[name] = value
  }
  return { version: 1, sessions }
}

/**
 * Group tool names for the checkbox page. The group is the name prefix before
 * the first underscore, with the filesystem tools kept together.
 * @param {Array<{name: string, tokens: number, summary?: string}>} tools
 * @returns {Array<{group: string, label: string, tools: Array<object>, tokens: number}>}
 */
export function groupTools(tools) {
  const groups = new Map()
  for (const tool of tools) {
    const group = groupOfTool(tool.name)
    let entry = groups.get(group)
    if (entry === undefined) {
      entry = { group, label: GROUP_LABELS[group] ?? group, tools: [], tokens: 0 }
      groups.set(group, entry)
    }
    entry.tools.push(tool)
    entry.tokens += tool.tokens
  }
  return [...groups.values()]
    .map((entry) => ({ ...entry, tools: entry.tools.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.tokens - a.tokens || a.group.localeCompare(b.group))
}

/**
 * The group one tool belongs to; the page and the scenario templates share it.
 * @param {string} name
 * @returns {string}
 */
export function groupOfTool(name) {
  return GROUP_OVERRIDES[name] ?? String(name ?? '').split('_')[0]
}

/**
 * Which mask one session uses.
 *
 * Tool switches are per conversation: a session that saved its own mask keeps
 * it, one that never did follows the profile-wide default. This is the whole
 * rule, so the Host and the page cannot disagree about it.
 * @param {{hidden?: string[], sessions?: Record<string, {hidden?: string[]}>}} state
 * @param {string} sessionId
 * @returns {{hidden: string[], source: 'session' | 'global'}}
 */
export function resolveHidden(state, sessionId) {
  const key = String(sessionId ?? '')
  const override = key === '' ? undefined : state?.sessions?.[key]
  if (override !== undefined && Array.isArray(override.hidden)) {
    return { hidden: override.hidden, source: 'session' }
  }
  return { hidden: Array.isArray(state?.hidden) ? state.hidden : [], source: 'global' }
}

/**
 * Scenario templates derived from the tool groups actually present, so they
 * work for any preset instead of hard-coding tool names that may not exist.
 * `hidden` is the deny list; `keep` documents the intent in the UI.
 * @param {Array<{name: string}>} tools
 * @returns {Array<{name: string, note: string, hidden: string[]}>}
 */
export function builtInScenarios(tools) {
  const available = new Map()
  for (const tool of tools ?? []) {
    const group = groupOfTool(tool.name)
    if (!available.has(group)) available.set(group, [])
    available.get(group).push(tool.name)
  }
  const hideGroups = (groups) => groups.flatMap((group) => available.get(group) ?? []).sort()
  const keepGroups = (kept) => [...available.keys()]
    .filter((group) => !kept.includes(group))
    .flatMap((group) => available.get(group))
    .sort()
  const scenarios = [
    {
      name: '编码',
      note: '关掉网页、Office、定时任务：只留读代码、改文件、跑命令',
      hidden: hideGroups(['web', 'office', 'schedule', 'workflow']),
    },
    {
      name: '调研',
      note: '关掉终端和 Office：只读文件和查网页',
      hidden: hideGroups(['pwsh', 'bash', 'office', 'workflow', 'schedule']),
    },
    {
      name: '极简',
      note: '只留读写文件、搜索、待办和询问：工具表最短',
      hidden: keepGroups(['fs', 'fs_search', 'todo', 'ask_user_question', 'ask', 'plan', 'step']),
    },
  ]
  return scenarios.filter((scenario) => scenario.hidden.length > 0)
}

/**
 * Normalize saved scenarios (formerly "sets"): a name, a deny list, and an
 * optional note. Duplicate names collapse; the cap keeps the file small.
 * @param {unknown} value
 * @param {Set<string> | undefined} known
 * @param {number} [limit]
 * @returns {Array<{name: string, hidden: string[], note: string}>}
 */
export function normalizeScenarios(value, known, limit = 24) {
  const source = Array.isArray(value) ? value : []
  const seen = new Set()
  const scenarios = []
  for (const item of source) {
    if (item === null || typeof item !== 'object') continue
    const name = String(item.name ?? '').trim().slice(0, 40)
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    scenarios.push({
      name,
      hidden: normalizeHidden(item.hidden, known),
      note: String(item.note ?? '').trim().slice(0, 160),
    })
    if (scenarios.length >= limit) break
  }
  return scenarios
}

/**
 * The scenario a switch list currently corresponds to, so the panel can show
 * which scheme is selected and fall back to "自定义" for a hand-tuned list.
 * @param {Array<{name: string, hidden: string[]}>} scenarios
 * @param {string[] | Set<string>} hidden
 * @returns {string} scenario name, or '' when no scenario matches
 */
export function scenarioOf(scenarios, hidden) {
  const target = [...(hidden instanceof Set ? hidden : Array.isArray(hidden) ? hidden : [])].sort().join('\n')
  for (const scenario of scenarios ?? []) {
    const list = [...(scenario.hidden ?? [])].sort().join('\n')
    if (list === target) return scenario.name
  }
  return ''
}

/**
 * Rough token cost of a tool schema, from its rendered JSON size.
 * @param {number} chars
 * @returns {number}
 */
export function estimateTokens(chars) {
  return Math.max(8, Math.round(Number(chars ?? 0) / 3.5))
}

/**
 * Normalize a saved tool set: unique, lowercase-ish tool names, capped.
 * @param {unknown} value
 * @param {Set<string>} known
 * @returns {string[]}
 */
export function normalizeHidden(value, known) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (known !== undefined && !known.has(item)) continue
    seen.add(item)
  }
  return [...seen].sort()
}

const GROUP_OVERRIDES = Object.freeze({
  read: 'fs',
  write: 'fs',
  edit: 'fs',
  apply_patch: 'fs',
  glob: 'fs_search',
  grep: 'fs_search',
  ls: 'fs_search',
})

const GROUP_LABELS = Object.freeze({
  fs: '文件读写',
  fs_search: '文件搜索',
  pwsh: '终端',
  bash: '终端',
  web: '网页',
  office: 'Office 文档',
  subagent: '子代理',
  workflow: '工作流',
  schedule: '定时任务',
  jobs: '后台任务',
  goal: '目标',
  skill: '技能',
  todo: '待办',
  plan: '切片工作法',
  step: '切片工作法',
  exit_plan_mode: '计划模式',
  present: '交付文件',
  ask_user_question: '询问用户',
  load_workspace_dependencies: '工作区依赖',
  plugin_manager: '插件管理',
  ask: '询问用户',
})

function oneLine(text, maxChars) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
}

function lastLines(text, count) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(-count)
    .join('；')
}

function clamp(text, maxChars) {
  const value = String(text ?? '')
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 20)}\n…（已截断）`
}
