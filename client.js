window.__ModuleLoader__.load({
  id: '@local/dsh-tool-slice',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const NS = '@local/dsh-tool-slice'
    const ENDPOINT = '/api/tool-slice'
    const DOCK_KEY = 'dsh.tool-slice.dock'

    const css = `
.tsl-card{color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:16px;background:var(--dsw-alias-bg-module-platform,transparent);overflow:hidden;font-size:14px}
.tsl-card summary{cursor:pointer;list-style:none;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.tsl-card summary::-webkit-details-marker{display:none}
.tsl-card h3{font-size:16px;margin:0 0 7px;font-weight:600}
.tsl-muted{color:var(--dsw-alias-label-secondary,#888);font-size:13px;line-height:1.65;margin:0}
.tsl-chevron{transition:transform .15s}.tsl-card[open] .tsl-chevron{transform:rotate(180deg)}
.tsl-body{padding:0 24px 22px}.tsl-divider{border-top:1px solid var(--dsw-alias-border-l3,#8884);padding-top:18px}
.tsl-stats{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 16px}
.tsl-pill{border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:999px;padding:4px 11px;font-size:12px;color:var(--dsw-alias-label-secondary,#888)}
.tsl-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.tsl-input,.tsl-select{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:9px;padding:7px 10px;min-width:0}
.tsl-input{flex:1 1 180px}
.tsl-input:focus-visible,.tsl-select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3478f6);outline-offset:2px}
.tsl-groups{display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto;padding-right:4px;margin:0 0 16px}
.tsl-group{border:1px solid var(--dsw-alias-border-l3,#8884);border-radius:12px;padding:10px 12px}
.tsl-group-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.tsl-group-title{font-weight:600;font-size:13px}
.tsl-group-tokens{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);margin-left:auto;font-variant-numeric:tabular-nums}
.tsl-row{display:flex;gap:9px;align-items:flex-start;padding:4px 0 4px 2px;border-radius:8px}
.tsl-row:hover{background:var(--dsw-alias-bg-module-secondary,#8881)}
.tsl-row label{display:flex;gap:9px;align-items:flex-start;cursor:pointer;width:100%}
.tsl-check{margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary,#3478f6);cursor:pointer}
.tsl-name{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px}
.tsl-summary{font-size:12px;color:var(--dsw-alias-label-secondary,#888);line-height:1.5}
.tsl-tokens{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888);margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
.tsl-sets{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.tsl-set{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:999px;padding:4px 6px 4px 11px;font-size:12.5px}
.tsl-set button{font:inherit;font-size:12px;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.65;padding:0 3px}
.tsl-set button:hover{opacity:1}
.tsl-set-builtin{border-style:dashed;color:var(--dsw-alias-label-secondary,#888)}
.tsl-scen{margin:0 0 12px}
.tsl-scen-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.tsl-scen-label{font-size:12.5px;color:var(--dsw-alias-label-secondary,#888)}
.tsl-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.tsl-button{font:inherit;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:9px;padding:8px 14px;cursor:pointer;color:inherit;background:transparent}
.tsl-button:disabled{cursor:default;opacity:.45}
.tsl-button-primary{background:var(--dsw-alias-state-business-primary,#3478f6);border-color:transparent;color:white}
.tsl-status{font-size:12px;color:var(--dsw-alias-label-secondary,#888);margin-left:auto}
.tsl-error{color:var(--dsw-alias-state-error-primary,#e55353);margin-top:10px;font-size:13px}
.tsl-note{margin:10px 0 0;padding:11px 14px;border-radius:10px;background:var(--dsw-alias-bg-module-secondary,#8881)}
@media(max-width:480px){.tsl-card summary{padding:18px}.tsl-body{padding:0 18px 18px}.tsl-status{width:100%;margin-left:0}}
.tsd{position:relative;width:100%;display:flex;flex-direction:column;align-items:center;color:var(--dsw-alias-label-primary,inherit);font-size:12.5px}
.tsd-bar{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px}
.tsd-chip{font:inherit;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l3,#8885);background:var(--dsw-alias-bg-module-secondary,#8881);color:var(--dsw-alias-label-secondary,#888);border-radius:999px;padding:3px 10px;cursor:pointer;line-height:1.5}
.tsd-chip:hover{color:var(--dsw-alias-label-primary,inherit)}
.tsd-chip[data-on="true"]{color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-state-business-primary,#3478f6)}
.tsd-chip b{font-weight:600;font-variant-numeric:tabular-nums}
.tsd-dot{width:7px;height:7px;border-radius:999px;background:currentColor;opacity:.55}
/* Floating card, opened upward off the chip row exactly like the composer's
   own menus (slash popup, preset picker, model picker): the trigger sits at the
   bottom of the screen, so the card grows up over the transcript, never down
   over the composer. The surface tokens match the host Menu card. */
.tsd-pop{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);width:min(620px,calc(100vw - 32px));box-sizing:border-box;z-index:100;display:flex;flex-direction:column;max-height:min(460px,70vh);overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-module-platform,#1f2023);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,#8884);box-shadow:var(--dsw-elevation-prominent,0 10px 30px #0007);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,transparent);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,transparent)}
/* The actions row never scrolls away: the scrollport is the body above it, so
   Save and Undo stay pinned to the card's bottom edge however long the tool
   list or the plan gets. */
.tsd-pop-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 14px}
.tsd-pop-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l3,#8884);background:var(--dsw-alias-bg-module-platform,#1f2023)}
.tsd-pop-foot .tsl-status{margin-left:auto}
.tsd-pop-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.tsd-pop .tsl-groups{max-height:none;overflow:visible;margin-bottom:4px}
.tsd-pop .tsl-group{padding:8px 10px}
.tsd-pop .tsl-stats{margin:0 0 10px}
.tsd-pop-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px 0;flex:0 0 auto}
.tsd-pop-title{font-weight:600;font-size:13px}
.tsd-pop-head .tsl-status{margin-left:auto}
.tsd-close{font:inherit;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#888);cursor:pointer;padding:0 4px;font-size:14px;line-height:1}
.tsd-close:hover{color:var(--dsw-alias-label-primary,inherit)}
.tsd-goal{font-size:13px;font-weight:600;margin:0 0 4px;line-height:1.5}
.tsd-current{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#888);font-size:12.5px;line-height:1.6}
.tsd-steps{display:flex;flex-direction:column;gap:3px;margin:8px 0 0;padding:0;list-style:none}
.tsd-step{display:flex;gap:8px;align-items:flex-start;padding:3px 0;font-size:12.5px;line-height:1.5}
.tsd-step[data-status="进行中"]{color:var(--dsw-alias-state-business-primary,#3478f6);font-weight:600}
.tsd-step[data-status="失败"] .tsd-step-title{color:var(--dsw-alias-state-error-primary,#e55353)}
.tsd-step[data-status="完成"]{color:var(--dsw-alias-label-tertiary,#888)}
.tsd-step-n{font-variant-numeric:tabular-nums;opacity:.7;min-width:1.4em}
.tsd-step-title{flex:1 1 auto}
.tsd-step-status{font-size:11px;opacity:.7;white-space:nowrap}
.tsd-textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:9px;padding:8px 10px;width:100%;min-height:54px;resize:vertical}
.tsd-textarea:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3478f6);outline-offset:2px}
.tsd-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.tsd-note{margin:8px 0 0;color:var(--dsw-alias-label-secondary,#888);font-size:12px;line-height:1.6;white-space:pre-wrap}
.tsd-error{margin:8px 0 0;color:var(--dsw-alias-state-error-primary,#e55353);font-size:12px;line-height:1.6;white-space:pre-wrap}
`

    async function request(path, init) {
      const response = await fetch(`${ENDPOINT}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      })
      const data = await response.json().catch(() => undefined)
      if (!response.ok || data === undefined) throw new Error(String(data?.error ?? `HTTP ${response.status}`))
      return data
    }

    function formatTokens(value) {
      const count = Number(value ?? 0)
      return count >= 1000 ? `~${(count / 1000).toFixed(1)}k` : `~${count}`
    }

    /**
     * The scenario the current switch list equals, so the picker can show the
     * scheme as selected instead of "自定义". Small enough to keep local: the
     * browser bundle cannot import the Host's ESM helpers.
     * @param {Array<{name: string, hidden: string[]}>} scenarios
     * @param {Set<string>} hidden
     * @returns {string}
     */
    function scenarioOf(scenarios, hidden) {
      const target = [...hidden].sort().join('\n')
      for (const scenario of scenarios ?? []) {
        if ([...(scenario.hidden ?? [])].sort().join('\n') === target) return scenario.name
      }
      return ''
    }

    /**
     * One store for the switch list, shared by the bundle page (the profile
     * default) and the dock (this conversation's own list).
     *
     * Nothing is written until the caller saves: a draft lets you try a mask,
     * see the token estimate, and back out, and it keeps one accidental click
     * from changing a running session. `sessionId` decides which file entry the
     * save touches, so two conversations never overwrite each other.
     * @param {{auto?: boolean, sessionId?: string}} options
     */
    function useSlice(options) {
      const auto = options?.auto !== false
      const sessionId = String(options?.sessionId ?? '')
      const suffix = sessionId === '' ? '' : `?session=${encodeURIComponent(sessionId)}`
      const [data, setData] = useState(undefined)
      const [hidden, setHidden] = useState(() => new Set())
      const [scenarios, setScenarios] = useState([])
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [query, setQuery] = useState('')
      const [scenarioName, setScenarioName] = useState('')

      // `keepDraft` is for a scenario create/delete: the shared scheme list
      // changes, but the unsaved switch list the user is comparing must stay.
      const adopt = useCallback((next, keepDraft = false) => {
        setData(next)
        if (!keepDraft) setHidden(new Set(next.hidden ?? []))
        setScenarios(Array.isArray(next.scenarios) ? next.scenarios : [])
      }, [])

      const load = useCallback((signal) => {
        fetch(`${ENDPOINT}/state${suffix}`, { credentials: 'same-origin', signal })
          .then((response) => response.json())
          .then((next) => { adopt(next); setError('') })
          .catch((cause) => {
            if (cause?.name !== 'AbortError') setError(`读取工具清单失败：${cause?.message ?? cause}`)
          })
      }, [adopt, suffix])

      useEffect(() => {
        if (!auto) return undefined
        const controller = new AbortController()
        load(controller.signal)
        return () => { controller.abort() }
      }, [auto, load])

      const tools = data?.tools ?? []
      const known = useMemo(() => new Set(tools.map((tool) => tool.name)), [tools])
      const groups = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const gathered = data?.groups ?? []
        if (needle === '') return gathered
        return gathered
          .map((group) => ({
            ...group,
            tools: group.tools.filter((tool) => tool.name.toLowerCase().includes(needle)
              || String(tool.summary ?? '').toLowerCase().includes(needle)),
          }))
          .filter((group) => group.tools.length > 0)
      }, [data, query])
      const enabledTokens = useMemo(
        () => tools.filter((tool) => !hidden.has(tool.name)).reduce((sum, tool) => sum + Number(tool.tokens ?? 0), 0),
        [tools, hidden],
      )
      const enabledCount = useMemo(() => tools.filter((tool) => !hidden.has(tool.name)).length, [tools, hidden])
      const savedTokens = data === undefined ? 0 : Math.max(0, (data.totalTokens ?? 0) - enabledTokens)
      const dirty = useMemo(() => {
        if (data === undefined) return false
        const saved = new Set(data.hidden ?? [])
        if (saved.size !== hidden.size) return true
        for (const name of hidden) if (!saved.has(name)) return true
        return false
      }, [data, hidden])

      /**
       * Write the draft. A session save records the conversation's own list; a
       * global save writes the default. Scenarios are separate and immediate.
       * @param {{hidden?: string[], followGlobal?: boolean}} [target]
       * @returns {Promise<boolean>}
       */
      const save = useCallback(async (target) => {
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const list = [...(target?.hidden ?? [...hidden])].sort()
          const next = await request(`/save${suffix}`, {
            method: 'POST',
            body: JSON.stringify(sessionId === ''
              ? { hidden: list }
              : { hidden: list, followGlobal: target?.followGlobal === true }),
          })
          adopt(next)
          setNotice(sessionId === ''
            ? '已保存为默认；正在运行的会话从下一个模型步骤开始生效。'
            : '已保存到本对话；从下一个模型步骤开始生效。')
          return true
        } catch (cause) {
          setError(`保存失败：${cause?.message ?? cause}`)
          return false
        } finally {
          setSaving(false)
        }
      }, [adopt, hidden, sessionId, suffix])

      /**
       * Create or replace a scenario from the current draft. Scenarios are
       * shared definitions, so this writes immediately and leaves the draft
       * alone: the panel can define a scheme while tuning it.
       * @returns {Promise<boolean>}
       */
      const saveAsScenario = useCallback(async () => {
        const name = String(scenarioName ?? '').trim().slice(0, 40)
        if (name === '') return false
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const next = await request(`/scenario${suffix}`, {
            method: 'POST',
            body: JSON.stringify({ action: 'save', name, hidden: [...hidden].sort() }),
          })
          adopt(next, true)
          setScenarioName('')
          setNotice(`已保存情景「${name}」（${hidden.size} 个工具关闭）`)
          return true
        } catch (cause) {
          setError(`保存情景失败：${cause?.message ?? cause}`)
          return false
        } finally {
          setSaving(false)
        }
      }, [adopt, hidden, scenarioName, suffix])

      /** Delete one shared scenario; the draft list stays as it is. */
      const removeScenario = useCallback(async (name) => {
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const next = await request(`/scenario${suffix}`, {
            method: 'POST',
            body: JSON.stringify({ action: 'delete', name }),
          })
          adopt(next, true)
          setNotice(`已删除情景「${name}」`)
          return true
        } catch (cause) {
          setError(`删除情景失败：${cause?.message ?? cause}`)
          return false
        } finally {
          setSaving(false)
        }
      }, [adopt, suffix])

      function toggle(name, on) {
        setNotice('')
        setHidden((previous) => {
          const next = new Set(previous)
          if (on) next.delete(name)
          else next.add(name)
          return next
        })
      }

      function toggleGroup(group, on) {
        setNotice('')
        setHidden((previous) => {
          const next = new Set(previous)
          for (const tool of group.tools) {
            if (on) next.delete(tool.name)
            else next.add(tool.name)
          }
          return next
        })
      }

      /** Load one scenario into the draft, without saving it. */
      function applyScenario(scenario) {
        setNotice('')
        const allowed = (scenario?.hidden ?? []).filter((name) => known.size === 0 || known.has(name))
        setHidden(new Set(allowed))
      }

      return {
        data, hidden, scenarios, saving, error, notice, query, setQuery, sessionId, scenarioName,
        tools, groups, enabledCount, enabledTokens, savedTokens, dirty,
        ready: data !== undefined && data.ready !== false,
        builtIn: data?.builtInScenarios ?? [],
        override: data?.session?.override === true,
        source: data?.source ?? 'global',
        // Which scheme the draft currently equals, so the selector can show it.
        selected: scenarioOf([...scenarios, ...(data?.builtInScenarios ?? [])], hidden),
        load, save, adopt, toggle, toggleGroup, applyScenario, saveAsScenario, removeScenario,
        setHidden, setNotice, setError, setScenarioName,
      }
    }

    function renderTool(slice, tool) {
      return h('div', { className: 'tsl-row', key: tool.name },
        h('label', null,
          h('input', {
            className: 'tsl-check',
            type: 'checkbox',
            checked: !slice.hidden.has(tool.name),
            onChange: (event) => slice.toggle(tool.name, event.target.checked),
          }),
          h('span', null,
            h('div', { className: 'tsl-name' }, tool.name),
            tool.summary ? h('div', { className: 'tsl-summary' }, tool.summary) : null),
          h('span', { className: 'tsl-tokens' }, formatTokens(tool.tokens))))
    }

    function renderGroup(slice, group) {
      const allOn = group.tools.every((tool) => !slice.hidden.has(tool.name))
      const someOn = group.tools.some((tool) => !slice.hidden.has(tool.name))
      return h('div', { className: 'tsl-group', key: group.group },
        h('div', { className: 'tsl-group-head' },
          h('input', {
            className: 'tsl-check',
            type: 'checkbox',
            checked: allOn,
            ref: (node) => { if (node !== null) node.indeterminate = !allOn && someOn },
            onChange: (event) => slice.toggleGroup(group, event.target.checked),
            'aria-label': `切换${group.label}整组`,
          }),
          h('span', { className: 'tsl-group-title' }, group.label),
          h('span', { className: 'tsl-group-tokens' }, formatTokens(group.tokens))),
        group.tools.map((tool) => renderTool(slice, tool)))
    }

    function statsRow(slice) {
      if (!slice.ready) return null
      return h('div', { className: 'tsl-stats' },
        h('span', { className: 'tsl-pill', key: 'on' }, `已启用 ${slice.enabledCount}/${slice.tools.length}`),
        h('span', { className: 'tsl-pill', key: 'tok' }, `估算 ${formatTokens(slice.enabledTokens)} tokens/轮`),
        h('span', { className: 'tsl-pill', key: 'all' }, `全部启用 ${formatTokens(slice.data.totalTokens)}`),
        slice.savedTokens > 0 ? h('span', { className: 'tsl-pill', key: 'save' }, `省下 ${formatTokens(slice.savedTokens)}`) : null)
    }

    /**
     * The scenario picker: choose a saved or built-in scheme, define a new one
     * from the current switch list, or delete one you made. Both the page and
     * the dock render it, so a scheme is created exactly where it is used.
     * @param {object} slice store
     */
    function scenarioRow(slice) {
      const saved = slice.scenarios
      const builtIn = slice.builtIn
      const selectedSaved = saved.some((scenario) => scenario.name === slice.selected)

      function pick(name) {
        const target = saved.find((scenario) => scenario.name === name)
          ?? builtIn.find((scenario) => scenario.name === name)
        if (target !== undefined) slice.applyScenario(target)
      }

      const options = [
        h('option', { value: '', key: 'custom' }, slice.selected === '' ? '自定义（当前勾选）' : '自定义'),
        ...saved.map((scenario) => h('option', { value: scenario.name, key: `s-${scenario.name}` },
          scenario.name)),
        builtIn.length > 0
          ? h('optgroup', { label: '内置', key: 'builtin' },
              builtIn.map((scenario) => h('option', { value: scenario.name, key: `b-${scenario.name}` },
                `${scenario.name}（内置）`)))
          : null,
      ]

      return h('div', { className: 'tsl-scen' },
        h('div', { className: 'tsl-scen-line' },
          h('span', { className: 'tsl-scen-label' }, '情景'),
          h('select', {
            className: 'tsl-select',
            value: slice.selected === '' ? '' : slice.selected,
            style: { flex: '1 1 160px' },
            onChange: (event) => pick(event.target.value),
            'aria-label': '选择工具情景',
          }, options),
          selectedSaved
            ? h('button', {
                type: 'button',
                className: 'tsl-button',
                title: '删除这个情景（不影响任何对话已保存的开关）',
                disabled: slice.saving,
                onClick: () => { void slice.removeScenario(slice.selected) },
              }, '删除')
            : null),
        h('div', { className: 'tsl-scen-line' },
          h('input', {
            className: 'tsl-input',
            value: slice.scenarioName,
            placeholder: '给当前这套勾选起个名字…',
            onChange: (event) => slice.setScenarioName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); void slice.saveAsScenario() }
            },
            'aria-label': '新情景名称',
          }),
          h('button', {
            type: 'button',
            className: 'tsl-button',
            disabled: slice.saving || slice.scenarioName.trim() === '',
            title: '把当前勾选保存成情景，之后随时选中它',
            onClick: () => { void slice.saveAsScenario() },
          }, '存为情景')),
        slice.selected !== ''
          ? h('p', { className: 'tsl-muted', style: { margin: '6px 0 0' } },
              `已选情景「${slice.selected}」——点下面的保存按钮才会用到本对话。`)
          : null)
    }

    function board(slice) {
      if (!slice.ready) {
        return h('div', { key: 'empty' },
          h('p', { className: 'tsl-muted' },
            slice.data === undefined
              ? '正在读取工具清单…'
              : '还没有会话创建过智能体，暂时读不到工具清单：先在任意会话里发一条消息，然后点「刷新清单」。'),
          h('button', {
            type: 'button',
            className: 'tsl-button',
            style: { marginTop: 10 },
            onClick: () => slice.load(),
          }, '刷新清单'))
      }
      return h('div', { key: 'board' },
        h('div', { className: 'tsl-tools' },
          h('input', {
            className: 'tsl-input',
            type: 'search',
            value: slice.query,
            placeholder: '搜索工具名或说明…',
            onChange: (event) => slice.setQuery(event.target.value),
            'aria-label': '搜索工具',
          }),
          h('button', {
            type: 'button',
            className: 'tsl-button',
            onClick: () => { slice.setHidden(new Set()); slice.setNotice('') },
          }, '全部启用'),
          h('button', {
            type: 'button',
            className: 'tsl-button',
            onClick: () => { slice.setHidden(new Set(slice.tools.map((tool) => tool.name))); slice.setNotice('') },
          }, '全部关闭')),
        h('div', { className: 'tsl-groups' }, slice.groups.map((group) => renderGroup(slice, group))))
    }

    /** The bundle page: the long-lived editor for the default and the scenarios. */
    function ToolSliceCard() {
      const slice = useSlice({ auto: true, sessionId: '' })

      const board0 = slice.ready
        ? h('div', { key: 'board' },
            scenarioRow(slice),
            h('div', { className: 'tsl-tools' },
              h('input', {
                className: 'tsl-input',
                type: 'search',
                value: slice.query,
                placeholder: '搜索工具名或说明…',
                onChange: (event) => slice.setQuery(event.target.value),
                'aria-label': '搜索工具',
              }),
              h('button', {
                type: 'button',
                className: 'tsl-button',
                onClick: () => { slice.setHidden(new Set()); slice.setNotice('') },
              }, '全部启用'),
              h('button', {
                type: 'button',
                className: 'tsl-button',
                onClick: () => { slice.setHidden(new Set(slice.tools.map((tool) => tool.name))); slice.setNotice('') },
              }, '全部关闭')),
            h('div', { className: 'tsl-groups' }, slice.groups.map((group) => renderGroup(slice, group))))
        : board(slice)

      return h('details', { className: 'tsl-card', open: true },
        h('style', null, css),
        h('summary', null,
          h('div', null,
            h('h3', null, '工具开关 · 默认与情景'),
            h('p', { className: 'tsl-muted' },
              '这里保存的是「默认」开关和「情景」；每个对话自己的开关在输入框下方的面板里设，互不影响。')),
          h('span', { className: 'tsl-chevron', 'aria-hidden': true }, '⌄')),
        h('div', { className: 'tsl-body' },
          h('div', { className: 'tsl-divider' }, statsRow(slice), board0),
          h('p', { className: 'tsl-note tsl-muted' },
            '「存为情景」立即保存；「保存」写的是默认开关。正在运行的会话在下一个模型步骤重新解析工具表。'),
          slice.data?.statePath
            ? h('p', { className: 'tsl-muted', style: { marginTop: 8 } }, `状态文件：${slice.data.statePath}`)
            : null,
          slice.error !== '' ? h('p', { className: 'tsl-error' }, slice.error) : null,
          h('div', { className: 'tsl-footer' },
            h('button', {
              type: 'button',
              className: 'tsl-button tsl-button-primary',
              disabled: !slice.ready || slice.saving || !slice.dirty,
              onClick: () => { void slice.save() },
            }, slice.saving ? '保存中…' : '保存默认'),
            h('button', {
              type: 'button',
              className: 'tsl-button',
              disabled: !slice.ready || slice.saving || !slice.dirty,
              onClick: () => { slice.adopt(slice.data); slice.setNotice('') },
            }, '撤销改动'),
            slice.notice !== '' ? h('span', { className: 'tsl-status' }, slice.notice) : null)))
    }

    function summaryText() {
      return '按需关闭工具定义，节省每次请求的工具定义 token；把任务拆成计划后逐步交给子代理执行。'
    }

    function readOpen() {
      try {
        const value = window.localStorage.getItem(DOCK_KEY)
        return value === 'tools' || value === 'plan' ? value : ''
      } catch {
        return ''
      }
    }

    function writeOpen(value) {
      try {
        if (value === '') window.localStorage.removeItem(DOCK_KEY)
        else window.localStorage.setItem(DOCK_KEY, value)
      } catch {
        /* a private window simply forgets the preference */
      }
    }

    function stepRow(step) {
      return h('li', { className: 'tsd-step', key: step.n, 'data-status': step.status },
        h('span', { className: 'tsd-step-n' }, step.n),
        h('span', { className: 'tsd-step-title', title: step.task }, step.title),
        h('span', { className: 'tsd-step-status' }, step.status))
    }

    /**
     * The panel beside the conversation: the same tool switches as the page
     * (saved on every click) plus the plan's controls and progress, so neither
     * needs a trip to the Plugins page.
     */
    function SliceDock(props) {
      const sessionId = props?.sessionId ?? ''
      const run = props?.run
      const [open, setOpen] = useState(readOpen)
      const [plan, setPlan] = useState(undefined)
      const [planReason, setPlanReason] = useState('')
      const [planError, setPlanError] = useState('')
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState('')
      const [goal, setGoal] = useState('')
      const [feedback, setFeedback] = useState('')
      const [showSteps, setShowSteps] = useState(false)
      const [spaceAbove, setSpaceAbove] = useState(420)
      const rootRef = useRef(null)
      const pollRef = useRef(null)
      const aliveRef = useRef(true)
      const slice = useSlice({ auto: true, sessionId })

      // The popover floats over the transcript above the composer, so its height
      // cap comes from the space that actually exists there (a short window
      // would otherwise push the card off the top of the screen).
      useEffect(() => {
        if (open === '') return undefined
        const measure = () => {
          const node = rootRef.current
          if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return
          const rect = node.getBoundingClientRect()
          setSpaceAbove(Math.max(200, Math.min(420, rect.top - 16)))
        }
        measure()
        window.addEventListener('resize', measure)
        return () => { window.removeEventListener('resize', measure) }
      }, [open])

      // The card covers part of the composer while it is open, so a click
      // anywhere outside it (the input, the transcript, a sidebar) dismisses it,
      // exactly like the composer's own menus.
      useEffect(() => {
        if (open === '') return undefined
        const dismiss = () => { writeOpen(''); setOpen('') }
        const onDown = (event) => {
          const node = rootRef.current
          if (node === null || node === undefined || typeof node.contains !== 'function') return
          if (!node.contains(event.target)) dismiss()
        }
        const onKey = (event) => { if (event.key === 'Escape') dismiss() }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      useEffect(() => {
        aliveRef.current = true
        return () => {
          aliveRef.current = false
          if (pollRef.current !== null && pollRef.current !== undefined) clearInterval(pollRef.current)
        }
      }, [])

      const loadPlan = useCallback((signal) => {
        if (sessionId === '') { setPlanReason('no-session'); return }
        fetch(`${ENDPOINT}/plan?session=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', signal })
          .then((response) => response.json())
          .then((next) => {
            setPlan(next?.plan ?? null)
            setPlanReason(String(next?.reason ?? ''))
            setPlanError(next?.plan === null && next?.error ? String(next.error) : '')
          })
          .catch((cause) => {
            if (cause?.name !== 'AbortError') setPlanError(`读取计划失败：${cause?.message ?? cause}`)
          })
      }, [sessionId])

      useEffect(() => {
        if (open !== 'plan') return undefined
        const controller = new AbortController()
        loadPlan(controller.signal)
        return () => { controller.abort() }
      }, [open, loadPlan])

      // While a step is running, keep the progress line current; the plan file
      // is written before the child starts and when its report lands.
      useEffect(() => {
        if (open !== 'plan' || !busy) return undefined
        const timer = setInterval(() => { loadPlan() }, 2500)
        return () => { clearInterval(timer) }
      }, [open, busy, loadPlan])

      async function exec(line) {
        if (typeof run !== 'function') {
          setStatus('这个页面拿不到指令通道：请刷新页面，或重启 DSH 让插件生效。')
          return false
        }
        setStatus('执行中…')
        try {
          const result = await run(line)
          if (result?.ok === false) {
            setStatus(`指令失败：${result.error?.message ?? '未知原因'}${result.error?.code ? `（${result.error.code}）` : ''}`)
            return false
          }
          const value = result?.value
          if (value === undefined) {
            setStatus('当前会话没有 /slice 指令：新版插件需要重启 DSH 后才可用。')
            return false
          }
          setStatus(String(value.text ?? ''))
          return value.kind !== 'error'
        } catch (cause) {
          setStatus(`指令失败：${cause?.message ?? cause}`)
          return false
        }
      }

      function togglePanel(which) {
        const next = open === which ? '' : which
        writeOpen(next)
        setOpen(next)
      }

      async function nextStep() {
        if (busy) return
        setBusy(true)
        try {
          const ok = await exec('/slice next')
          if (ok && aliveRef.current) setShowSteps(false)
        } finally {
          if (aliveRef.current) {
            setBusy(false)
            loadPlan()
          }
        }
      }

      async function createPlan() {
        const text = goal.trim()
        if (text === '' || busy) return
        setBusy(true)
        try {
          const ok = await exec(`/slice plan ${text}`)
          if (ok && aliveRef.current) setGoal('')
        } finally {
          if (aliveRef.current) setBusy(false)
        }
      }

      async function revisePlan() {
        const text = feedback.trim()
        if (text === '' || busy) return
        setBusy(true)
        try {
          const ok = await exec(`/slice revise ${text}`)
          if (ok && aliveRef.current) setFeedback('')
        } finally {
          if (aliveRef.current) {
            setBusy(false)
            // The model rewrites the plan file in its next turn; poll briefly so
            // the panel catches up without a manual refresh.
            let tries = 0
            if (pollRef.current !== null && pollRef.current !== undefined) clearInterval(pollRef.current)
            pollRef.current = setInterval(() => {
              tries += 1
              if (!aliveRef.current || tries > 12) { clearInterval(pollRef.current); pollRef.current = null; return }
              loadPlan()
            }, 2500)
          }
        }
      }

      const planChip = plan === null || plan === undefined
        ? h('button', { type: 'button', className: 'tsd-chip', 'data-on': String(open === 'plan'), onClick: () => togglePanel('plan') },
            h('span', { className: 'tsd-dot', 'aria-hidden': true }),
            '计划 未建')
        : h('button', { type: 'button', className: 'tsd-chip', 'data-on': String(open === 'plan'), onClick: () => togglePanel('plan') },
            h('span', { className: 'tsd-dot', 'aria-hidden': true }),
            '计划 ',
            h('b', null, `${plan.done}/${plan.total}`),
            plan.current === null ? ' ·已完成' : ` ·第 ${plan.current.n} 步`)

      const toolChip = h('button', {
        type: 'button',
        className: 'tsd-chip',
        'data-on': String(open === 'tools'),
        onClick: () => togglePanel('tools'),
        title: '关闭用不到的工具，减少每轮的工具定义 token',
      },
        h('span', { className: 'tsd-dot', 'aria-hidden': true }),
        '工具 ',
        h('b', null, slice.ready ? `${slice.enabledCount}/${slice.tools.length}` : '…'))

      const toolPanel = open === 'tools'
        ? h('div', { className: 'tsd-pop', style: { maxHeight: `${spaceAbove}px` } },
            h('div', { className: 'tsd-pop-head' },
              h('span', { className: 'tsd-pop-title' }, '本对话的工具开关'),
              h('span', { className: 'tsl-pill' }, slice.override ? '仅本对话' : '跟随默认'),
              h('button', { type: 'button', className: 'tsd-close', onClick: () => togglePanel(''), 'aria-label': '收起' }, '×')),
            h('div', { className: 'tsd-pop-body' },
              statsRow(slice),
              scenarioRow(slice),
              board(slice),
              h('p', { className: 'tsd-note' },
                '改完点底部的「保存本对话」才会生效，且只影响这个对话；其他对话用各自的开关或默认值。'),
              slice.error !== '' ? h('p', { className: 'tsd-error' }, slice.error) : null),
            // Pinned footer: the scrollport is the body, so Save and Undo are on
            // screen no matter how long the tool list is.
            h('div', { className: 'tsd-pop-foot' },
              h('button', {
                type: 'button',
                className: 'tsl-button tsl-button-primary',
                disabled: !slice.ready || slice.saving || !slice.dirty,
                onClick: () => { void slice.save() },
              }, slice.saving ? '保存中…' : slice.dirty ? '保存本对话' : '已保存'),
              h('button', {
                type: 'button',
                className: 'tsl-button',
                disabled: !slice.ready || slice.saving || !slice.dirty,
                onClick: () => { slice.adopt(slice.data); slice.setNotice('') },
              }, '撤销'),
              slice.override
                ? h('button', {
                    type: 'button',
                    className: 'tsl-button',
                    disabled: slice.saving,
                    title: '删除本对话自己的开关，回到默认值',
                    onClick: () => { void slice.save({ followGlobal: true }) },
                  }, '跟随默认')
                : null,
              h('span', { className: 'tsl-status' }, slice.saving ? '保存中…' : slice.notice)))
        : null

      const planBody = plan === null || plan === undefined
        ? h('div', null,
            h('p', { className: 'tsd-note', style: { marginTop: 0 } },
              planReason === 'no-session'
                ? '这个位置拿不到会话 ID：请在会话里刷新页面。'
                : '还没有计划。写一句你想达到的结果，点「开始规划」：模型会先问几个关键问题，'
                  + '再给出分步计划，写完停下等你确认。'),
            h('textarea', {
              className: 'tsd-textarea',
              value: goal,
              placeholder: '例如：给登录页加上验证码校验，并补上测试',
              onChange: (event) => setGoal(event.target.value),
              rows: 2,
            }),
            h('div', { className: 'tsd-actions' },
              h('button', {
                type: 'button',
                className: 'tsl-button tsl-button-primary',
                disabled: busy || goal.trim() === '',
                onClick: () => { void createPlan() },
              }, busy ? '已发送…' : '开始规划'),
              h('button', { type: 'button', className: 'tsl-button', onClick: () => loadPlan() }, '刷新')))
        : h('div', null,
            h('p', { className: 'tsd-goal' }, plan.goal || '（计划没有写目标）'),
            h('p', { className: 'tsd-current' },
              `${plan.progress}${plan.revision > 1 ? ` · 第 ${plan.revision} 版` : ''}${plan.failed > 0 ? ` · 失败 ${plan.failed}` : ''}`,
              plan.current === null ? '' : `\n下一步：第 ${plan.current.n} 步 ${plan.current.title}`,
              plan.current === null || plan.current.task === '' ? '' : `\n做什么：${plan.current.task}`),
            h('div', { className: 'tsd-actions' },
              h('button', {
                type: 'button',
                className: 'tsl-button tsl-button-primary',
                disabled: busy || plan.current === null,
                onClick: () => { void nextStep() },
              }, busy ? '执行中…' : '执行下一步'),
              h('button', { type: 'button', className: 'tsl-button', onClick: () => loadPlan() }, '刷新'),
              h('button', { type: 'button', className: 'tsl-button', onClick: () => setShowSteps(!showSteps) },
                showSteps ? '收起步骤' : `看全部 ${plan.total} 步`),
              h('button', { type: 'button', className: 'tsl-button', onClick: () => setPlan(undefined) }, '新建计划')),
            showSteps ? h('ol', { className: 'tsd-steps' }, plan.steps.map(stepRow)) : null,
            h('div', { style: { marginTop: 12, borderTop: '1px solid var(--dsw-alias-border-l3,#8884)', paddingTop: 10 } },
              h('p', { className: 'tsd-note', style: { marginTop: 0 } },
                '改计划就写在这里：模型会按你的意见重写整份计划，已完成的步骤和报告自动保留。'),
              h('textarea', {
                className: 'tsd-textarea',
                value: feedback,
                placeholder: '例如：第 3 步太笼统，改成先补测试再改中间件；一共只要 4 步',
                onChange: (event) => setFeedback(event.target.value),
                rows: 2,
              }),
              h('div', { className: 'tsd-actions' },
                h('button', {
                  type: 'button',
                  className: 'tsl-button',
                  disabled: busy || feedback.trim() === '',
                  onClick: () => { void revisePlan() },
                }, busy ? '已发送…' : '发给模型修订'))))

      const planPanel = open === 'plan'
        ? h('div', { className: 'tsd-pop', style: { maxHeight: `${spaceAbove}px` } },
            h('div', { className: 'tsd-pop-head' },
              h('span', { className: 'tsd-pop-title' }, '切片计划'),
              h('button', { type: 'button', className: 'tsd-close', onClick: () => togglePanel(''), 'aria-label': '收起' }, '×')),
            h('div', { className: 'tsd-pop-body' },
              planBody,
              status !== '' ? h('p', { className: 'tsd-note' }, status) : null,
              planError !== '' ? h('p', { className: 'tsd-error' }, planError) : null))
        : null

      return h('div', { className: 'tsd', ref: rootRef },
        h('style', null, css),
        h('div', { className: 'tsd-bar' }, toolChip, planChip),
        planPanel,
        toolPanel)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: NS },
          (props) => (props?.view === 'summary' ? summaryText() : h(ToolSliceCard, null)),
        ))
        // The command channel is optional: a page without the remote service
        // still renders the switches and reports the missing channel.
        let executeCommand
        if (typeof ctx.inject === 'function') {
          ctx.inject(['remote', 'remote.commands'], (scope) => {
            const commands = scope?.remote?.commands
            if (commands !== undefined && typeof commands.execute === 'function') {
              executeCommand = (sessionId, line) => commands.execute(sessionId, line, [])
            }
          })
        }
        // The composer dock is where a user looks while talking; the page stays
        // for a full edit, the dock for a one-click switch.
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'tool-slice-dock',
          order: 20,
          inject: (sessionId) => ({
            sessionId: String(sessionId ?? ''),
            run: (line) => executeCommand === undefined
              ? Promise.reject(new Error('这个页面没有指令通道（remote.commands 不可用），请重启 DSH 让插件生效'))
              : executeCommand(sessionId, line),
          }),
        }, SliceDock))
      },
    }
  },
})