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
  cancelled: '已取消',
})

/** Statuses a step can be started from. */
const RUNNABLE = new Set([STATUS.todo, STATUS.cancelled, STATUS.failed])

const STEP_HEADING = /^### (\d+)\.\s+(.+?)\s+——\s+(待办|进行中|完成|失败|已取消)\s*$/
const RECORD_HEADING = /^### 步骤 (\d+)\s+——\s+(待办|进行中|完成|失败|已取消)\s*$/
const GOAL_LINE = /^#\s*任务[：:]\s*(.*)$/
/** Header value that means "the human has not confirmed this revision yet". */
export const NOT_APPROVED = '未确认'

/**
 * The permission profiles a plan can assign to one step. A profile is a coarse
 * intent the planner can reason about; the concrete deny list is derived at run
 * time from the tools the child actually mounts.
 */
export const ACCESS_PROFILES = Object.freeze([
  { id: '只读', note: '只能看：read / glob / grep / ls，外加待办、询问、后台任务查询' },
  { id: '读写', note: '能改文件：在上面基础上加 write / edit，仍不能开终端、不能上网' },
  { id: '全量', note: '不限制：终端、网页、Office 等全部可用' },
])

const READ_ONLY_TOOLS = new Set(['read', 'glob', 'grep', 'ls'])
const SAFE_GROUPS = new Set(['fs_search', 'todo', 'ask', 'plan', 'step', 'jobs'])

/**
 * Read a permission profile in either language, returning the canonical label.
 * @param {unknown} value
 * @returns {string} `只读` | `读写` | `全量` | '' when unknown
 */
export function normalizeAccess(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '只读' || text === 'read' || text === 'readonly' || text === 'read-only') return '只读'
  if (text === '读写' || text === 'edit' || text === 'write' || text === 'edit-write') return '读写'
  if (text === '全量' || text === 'full' || text === 'all') return '全量'
  return ''
}

/**
 * Render the whole plan document.
 * @param {{goal: string, session?: string, createdAt?: string, approvedAt?: string, steps: Array<{n?: number, title: string, task: string, done?: string, model?: string, hidden?: string[], status?: string, record?: string}>}} plan
 * @returns {string} Markdown
 */
export function renderPlan(plan) {
  const steps = plan.steps ?? []
  const finished = steps.filter((step) => step.status === STATUS.done).length
  const approvedAt = typeof plan.approvedAt === 'string' ? plan.approvedAt : ''
  const lines = [
    `# 任务：${oneLine(plan.goal, 200)}`,
    '',
    `- 会话：${oneLine(plan.session ?? '-', 40)}`,
    `- 创建：${oneLine(plan.createdAt ?? '-', 40)}`,
    `- 进度：${finished}/${steps.length} 完成`,
    `- 确认：${approvedAt === '' ? NOT_APPROVED : oneLine(approvedAt, 40)}`,
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
    if (typeof step.access === 'string' && step.access !== '') lines.push(`权限：${oneLine(step.access, 20)}`)
    if (typeof step.model === 'string' && step.model !== '') lines.push(`模型：${oneLine(step.model, 120)}`)
    if (typeof step.startedAt === 'string' && step.startedAt !== '') lines.push(`开始：${oneLine(step.startedAt, 40)}`)
    if (Array.isArray(step.dependsOn) && step.dependsOn.length > 0) lines.push(`依赖：${step.dependsOn.join(', ')}`)
    if (Array.isArray(step.hidden) && step.hidden.length > 0) lines.push(`关闭工具：${step.hidden.map(name => oneLine(name, 60)).join(', ')}`)
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
 * @returns {{goal: string, approvedAt: string, steps: Array<{n: number, title: string, task: string, done: string, access: string, model: string, hidden: string[], status: string, record: string}>}}
 */
export function parsePlan(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  let goal = ''
  let session
  let createdAt
  let approvedAt
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
      const approvedMatch = /^-\s*确认[：:]\s*(.*)$/.exec(line.trim())
      if (approvedMatch) {
        const value = approvedMatch[1].trim()
        approvedAt = value === '-' || value === NOT_APPROVED ? '' : value
        continue
      }
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
          access: '',
          model: '',
          hidden: [],
          startedAt: '',
          dependsOn: [],
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
        const accessMatch = /^权限[：:]\s*(.*)$/.exec(line.trim())
        if (accessMatch) {
          current.access = normalizeAccess(accessMatch[1])
          continue
        }
        const modelMatch = /^模型[：:]\s*(.*)$/.exec(line.trim())
        if (modelMatch) {
          current.model = modelMatch[1].trim()
          continue
        }
        const hiddenMatch = /^关闭工具[：:]\s*(.*)$/.exec(line.trim())
        if (hiddenMatch) {
          current.hidden = splitNames(hiddenMatch[1])
          continue
        }
        const startedMatch = /^开始[：:]\s*(.*)$/.exec(line.trim())
        if (startedMatch) {
          current.startedAt = startedMatch[1].trim()
          continue
        }
        const dependsMatch = /^依赖[：:]\s*(.*)$/.exec(line.trim())
        if (dependsMatch) {
          current.dependsOn = splitNumbers(dependsMatch[1])
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
          target = { n, title: `步骤 ${n}`, task: '', done: '', access: '', model: '', hidden: [], startedAt: '', status: recordMatch[2], record: '' }
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
    approvedAt: approvedAt ?? '',
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
 * @param {{goal?: string, createdAt?: string, revisedAt?: string, revision?: number, approvedAt?: string, steps?: Array<object>} | undefined} previous
 * @param {{goal: string, steps: Array<{title: string, task: string, done?: string, model?: string, hidden?: string[]}>}} incoming
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
    // A step the human already tuned keeps its model and tool policy, so a
    // discussion-only revision never throws away that decision.
    const model = step.model !== undefined && step.model !== ''
      ? oneLine(step.model, 120)
      : String(match?.model ?? '')
    const hidden = step.hidden !== undefined
      ? normalizeNames(step.hidden)
      : normalizeNames(match?.hidden)
    // The planner's permission profile survives unless the planner states a
    // new one; a granular deny list (a human edit) owns the step instead.
    const access = normalizeAccess(step.access ?? '') || (hidden.length > 0 ? '' : String(match?.access ?? ''))
    // Dependencies are positional, so a rewritten plan restates them or keeps the
    // previous wiring for the same title.
    const dependsOn = step.dependsOn !== undefined
      ? normalizeDeps(step.dependsOn, index + 1)
      : normalizeDeps(match?.dependsOn, index + 1)
    return {
      n: index + 1,
      title: oneLine(step.title, 120) || `步骤 ${index + 1}`,
      task: oneLine(step.task, 4000),
      done: oneLine(step.done ?? '', 2000),
      access,
      model,
      hidden,
      dependsOn,
      // A carried-over step is not running any more; only a fresh execution
      // stamps `startedAt`.
      startedAt: '',
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
      access: String(step.access ?? ''),
      model: String(step.model ?? ''),
      hidden: normalizeNames(step.hidden),
      startedAt: '',
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
      // Any rewrite of the plan withdraws the human's confirmation: the text
      // that was confirmed no longer exists.
      approvedAt: '',
      ...(revision > 1 ? { revisedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), revision } : { revision: 1 }),
      steps,
    },
    kept: steps.filter((step) => step.status === STATUS.done).length,
    appended: appended.length,
    revision,
  }
}

/**
 * Replace one step's model and tool policy without touching its status, task,
 * or recorded report. The panel is the only caller: a human choosing what runs
 * a step must not also reset work that already happened.
 *
 * A granular `hidden` clears the declared permission profile: once a human
 * unchecks individual tools, the coarse label no longer describes the step.
 * @param {{steps: Array<object>}} plan
 * @param {number} n
 * @param {{model?: string, hidden?: string[], access?: string}} patch
 * @returns {{plan: object, error?: string}}
 */
export function patchStep(plan, n, patch) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : []
  const target = steps.find((step) => step.n === n)
  if (target === undefined) return { plan, error: `没有第 ${n} 步` }
  const next = steps.map((step) => {
    if (step !== target) return step
    if (patch.access !== undefined) {
      return { ...step, access: normalizeAccess(patch.access), ...(patch.hidden === undefined ? { hidden: [] } : {}) }
    }
    return {
      ...step,
      ...(patch.model === undefined ? {} : { model: oneLine(patch.model, 120) }),
      ...(patch.hidden === undefined ? {} : { hidden: normalizeNames(patch.hidden), access: '' }),
    }
  })
  return { plan: { ...plan, steps: next } }
}

/**
 * Mark the plan confirmed or withdraw that confirmation.
 * @param {{steps: Array<object>}} plan
 * @param {boolean} approved
 * @returns {object} the plan with a fresh or cleared confirmation stamp
 */
export function markApproved(plan, approved) {
  return {
    ...plan,
    approvedAt: approved ? new Date().toISOString().slice(0, 16).replace('T', ' ') : '',
  }
}

/**
 * Whether a plan may run a step: the human confirmed this exact revision.
 * @param {{approvedAt?: string}} plan
 * @returns {boolean}
 */
export function isApproved(plan) {
  return typeof plan?.approvedAt === 'string' && plan.approvedAt !== ''
}

/**
 * How a step's permissions read in a one-line summary.
 * @param {{access?: string, hidden?: string[]}} step
 * @returns {string}
 */
export function accessLabel(step) {
  const declared = normalizeAccess(step?.access)
  if (declared !== '') return declared
  const hidden = normalizeNames(step?.hidden)
  return hidden.length > 0 ? `自定义（关闭 ${hidden.length} 个工具）` : '全量'
}

/**
 * How a step's model reads in a one-line summary.
 * @param {{model?: string}} step
 * @returns {string}
 */
export function modelLabel(step) {
  const model = String(step?.model ?? '')
  return model === '' ? '继承父会话' : model
}

function titleKey(title) {
  return String(title ?? '').replace(/\s+/g, '').replace(/（已归档）/g, '')
}

/**
 * The step to run next: the first one that is neither finished nor failed, and
 * otherwise the first failed one, so a plan whose steps all failed can be
 * retried with the same "next step" action instead of reading as finished.
 * @param {{steps: Array<{n: number, status: string}>}} plan
 * @returns {object | undefined}
 */
export function nextStep(plan) {
  const steps = plan.steps ?? []
  // "Next" includes a step still marked running: after a crash or a restart
  // nothing is executing it, and re-running it is the only way forward. A live
  // run is protected by the runtime's active-run registry instead.
  return [...steps]
    .sort((left, right) => left.n - right.n)
    .find((step) => step.status !== STATUS.done && depsSatisfied(steps, step))
}

/**
 * Whether a step's declared dependencies are all finished.
 * @param {Array<object>} steps plan steps
 * @param {object} step
 * @returns {boolean}
 */
export function depsSatisfied(steps, step) {
  const deps = normalizeDeps(step?.dependsOn, step?.n)
  if (deps.length === 0) return true
  return deps.every((n) => {
    const target = steps.find((candidate) => candidate.n === n)
    // A dependency the plan no longer has is treated as satisfied: the plan was
    // rewritten, and blocking forever on a missing number helps nobody.
    return target === undefined || target.status === STATUS.done
  })
}

/**
 * Every step that may start now: runnable status, dependencies satisfied, and
 * not already running. Ordered by step number.
 * @param {{steps: Array<object>}} plan
 * @returns {Array<object>}
 */
export function readySteps(plan) {
  const steps = plan.steps ?? []
  return steps
    .filter((step) => RUNNABLE.has(step.status))
    .filter((step) => depsSatisfied(steps, step))
    .sort((left, right) => left.n - right.n)
}

/**
 * The status of every step as a compact table the conversation can read, so a
 * three-step plan shows 待办/进行中/失败/已取消/完成 for all three at each step.
 * @param {{steps: Array<object>}} plan
 * @returns {string}
 */
export function statusTable(plan) {
  const steps = plan.steps ?? []
  if (steps.length === 0) return ''
  const width = String(steps.length).length
  return steps.map((step) => {
    const deps = normalizeDeps(step.dependsOn, step.n)
    const suffix = deps.length > 0 ? `  依赖 ${deps.join(',')}` : ''
    const model = String(step.model ?? '')
    const who = model === '' ? '' : `  ${model}`
    return `${String(step.n).padStart(width)}. [${step.status ?? STATUS.todo}] ${oneLine(step.title, 40)}${who}${suffix}`
  }).join('\n')
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
    if (step !== undefined) return { step }
    const pending = (plan.steps ?? []).filter((candidate) => candidate.status !== STATUS.done)
    if (pending.length === 0) return { step: undefined, error: '所有步骤都已完成' }
    const blocked = pending.map((candidate) => candidate.n).join(', ')
    return { step: undefined, error: `第 ${blocked} 步还在等前置步骤完成（依赖未满足），没有可立即执行的步骤` }
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
  const cancelled = steps.filter((step) => step.status === STATUS.cancelled).length
  const next = nextStep({ steps })
  const ready = new Set(readySteps({ steps }).map((step) => step.n))
  return {
    goal: oneLine(plan?.goal ?? '', 200),
    total: steps.length,
    done,
    failed,
    cancelled,
    revision: Number(plan?.revision ?? 1),
    revisedAt: oneLine(plan?.revisedAt ?? '', 40),
    approved: isApproved(plan),
    approvedAt: oneLine(plan?.approvedAt ?? '', 40),
    progress: progressLine({ steps }),
    current: next === undefined
      ? null
      : {
        n: next.n,
        title: oneLine(next.title, 120),
        task: oneLine(next.task, 300),
        status: next.status ?? STATUS.todo,
        model: oneLine(next.model ?? '', 120),
        access: normalizeAccess(next.access),
        hidden: normalizeNames(next.hidden),
        startedAt: oneLine(next.startedAt ?? '', 40),
      },
    steps: steps.map((step) => ({
      n: step.n,
      title: oneLine(step.title, 120),
      status: step.status ?? STATUS.todo,
      task: oneLine(step.task, 240),
      done: oneLine(step.done ?? '', 160),
      access: normalizeAccess(step.access),
      model: oneLine(step.model ?? '', 120),
      hidden: normalizeNames(step.hidden),
      startedAt: oneLine(step.startedAt ?? '', 40),
      dependsOn: normalizeDeps(step.dependsOn, step.n),
      ready: ready.has(step.n),
      record: oneLine(step.record ?? '', 400),
    })),
    ready: ready.size,
    readySteps: [...ready].sort((left, right) => left - right),
    ...extra,
  }
}

/**
 * Grammar of the `/slice` command. Kept next to the plan format so the dock
 * buttons, the slash command, and the tests agree on one spelling.
 * @param {string} rawInput text after `slice`
 * @returns {{action: 'show' | 'next' | 'plan' | 'revise' | 'approve' | 'unapprove', step?: number, goal?: string, feedback?: string, error?: string}}
 */
export function parseSliceCommand(rawInput) {
  const text = String(rawInput ?? '').trim()
  if (text === '' || text === 'show' || text === 'status' || text === '进度') return { action: 'show' }
  if (text === 'approve' || text === '确认') return { action: 'approve' }
  const revoke = /^(?:approve\s+(?:off|no)|unapprove|取消确认)$/.exec(text)
  if (revoke !== null) return { action: 'unapprove' }
  const step = /^(?:next|run|step|执行)\s*(\d*)$/.exec(text)
  if (step !== null) {
    if (step[1] === '') return { action: 'next' }
    const n = Number(step[1])
    if (!Number.isInteger(n) || n < 1) return { action: 'next', error: `步骤号无效：${step[1]}` }
    return { action: 'next', step: n }
  }
  const stop = /^(?:stop|halt|cancel|停止|停|取消执行)$/.exec(text)
  if (stop !== null) return { action: 'stop' }
  if (/^(?:parallel|par|并行|一起跑)$/.test(text)) return { action: 'parallel' }
  if (/^(?:auto|all|run-all|顺次|自动|跑完|一路跑)$/.test(text)) return { action: 'auto' }
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
    error: `不认识的参数：${oneLine(text, 60)}；用法：/slice [plan <目标> | revise <意见> | approve | unapprove | next [步骤号] | auto | parallel | stop | show]`,
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
  plan: 'plan-act',
  step: 'plan-act',
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

/**
 * Read a comma-separated tool list back from the plan Markdown.
 * @param {string} text
 * @returns {string[]}
 */
function splitNames(text) {
  return String(text ?? '')
    .split(/[,，、]/)
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

/**
 * Read a comma-separated step-number list (the `依赖：` line).
 * @param {string} text
 * @returns {number[]}
 */
function splitNumbers(text) {
  return String(text ?? '')
    .split(/[,，、\s]+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((left, right) => left - right)
}

/**
 * Normalize a dependency list: positive integers, unique, sorted, never self.
 * @param {unknown} value
 * @param {number} [self]
 * @returns {number[]}
 */
export function normalizeDeps(value, self) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? splitNumbers(value) : []
  const seen = new Set()
  for (const item of source) {
    const n = Number(item)
    if (!Number.isInteger(n) || n <= 0 || n === self) continue
    seen.add(n)
  }
  return [...seen].sort((left, right) => left - right)
}

/**
 * Unique, sorted, non-empty tool names — the deny list a step is stored with.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeNames(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (name !== '') seen.add(name)
  }
  return [...seen].sort()
}

/**
 * Turn one step's permission profile into the deny list the child is restricted
 * with. Derived from the tools the child actually mounts, so a profile never
 * names a tool this deployment does not have.
 * @param {unknown} access permission profile (either language)
 * @param {Array<string | {name: string}>} tools tool names or definitions
 * @returns {string[]} sorted deny list; empty means "no restriction"
 */
export function accessHidden(access, tools) {
  const mode = normalizeAccess(access)
  if (mode === '' || mode === '全量') return []
  const names = []
  for (const tool of tools ?? []) {
    const name = typeof tool === 'string' ? tool : tool?.name
    if (typeof name === 'string' && name !== '') names.push(name)
  }
  const deny = []
  for (const name of names) {
    const group = groupOfTool(name)
    if (mode === '只读') {
      if (READ_ONLY_TOOLS.has(name) || SAFE_GROUPS.has(group)) continue
      deny.push(name)
      continue
    }
    // 读写: everything in the filesystem groups plus the harmless helpers.
    if (group === 'fs' || SAFE_GROUPS.has(group)) continue
    deny.push(name)
  }
  return [...new Set(deny)].sort()
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
