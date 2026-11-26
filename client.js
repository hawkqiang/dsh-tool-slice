window.__ModuleLoader__.load({
  id: '@local/dsh-tool-slice',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const NS = '@local/dsh-tool-slice'
    const ENDPOINT = '/api/tool-slice'
    const DOCK_KEY = 'dsh.tool-slice.dock'
    /**
     * Must equal `CODE_VERSION` in index.js. The page keeps the client bundle it
     * loaded, so after a Host-only reload this copy is stale; comparing the two
     * lets the chips say 「插件已更新，请刷新页面」 instead of looking unchanged.
     */
    const CODE_VERSION = 2

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
/* The New Session row is a compact flex line right-aligned beside the preset
   picker, so this chip must not claim the whole width, and its card has to grow
   down from the row instead of up over the fold. */
.tsd-hero{width:auto;flex:none;align-items:flex-end}
.tsd-hero .tsd-chip{font-size:12px;padding:2px 9px;gap:6px}
.tsd-hero .tsd-pop{top:calc(100% + 6px);bottom:auto;left:auto;right:0;transform:none;width:min(560px,calc(100vw - 24px))}
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
.tsd-step{flex-wrap:wrap}
.tsd-step-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;width:100%;padding-left:1.6em}
.tsd-step-controls .tsl-select{flex:1 1 160px;font-size:12px;padding:3px 6px}
.tsd-step-controls .tsl-button{font-size:12px;padding:3px 9px}
.tsd-tools{width:100%;margin:6px 0 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:10px}
.tsd-tools .tsl-groups{max-height:240px;overflow:auto}
.tsd-tools .tsl-group{padding:6px 8px}
.tsd-pill-warn{border-color:var(--dsw-alias-state-warning-primary,#d09a2d);color:var(--dsw-alias-state-warning-primary,#d09a2d)}
.tsd-pill-access{font-size:11px;padding:2px 8px;white-space:nowrap}
.tsd-status-todo{color:var(--dsw-alias-text-secondary,#8a8f98)}
.tsd-status-doing{color:var(--dsw-alias-state-info-primary,#3b82f6)}
.tsd-status-done{color:var(--dsw-alias-state-success-primary,#2e9e5b)}
.tsd-status-failed{color:var(--dsw-alias-state-error-primary,#d4544a)}
.tsd-status-cancelled{color:var(--dsw-alias-state-warning-primary,#d09a2d)}
.tsd-dep{font-size:11px;opacity:.7}
.tsd-stat{font-size:11px;opacity:.75;font-variant-numeric:tabular-nums}
.tsd-danger{color:var(--dsw-alias-state-error-primary,#d4544a)}
.tsd-unified{margin:6px 0 8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,#8884);border-radius:8px;background:var(--dsw-alias-bg-module-platform,#1f2023)}
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

      // `keepDraft` is for a save that only changed the shared default: the
      // caller's unsaved switch list must stay exactly as it was.
      const load = useCallback((signal, keepDraft = false) => {
        return fetch(`${ENDPOINT}/state${suffix}`, { credentials: 'same-origin', signal })
          .then((response) => response.json())
          .then((next) => { adopt(next, keepDraft); setError('') })
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
       * Save the current draft as the profile's **default** switch list.
       *
       * The default is what a conversation follows until it saves a list of its
       * own, so this is the one control a user needs in a brand-new session — and
       * the one the dock used to be missing (changing the default meant opening
       * Plugins → this bundle). The caller's own saved list is never touched.
       * @returns {Promise<boolean>}
       */
      const saveAsDefault = useCallback(async () => {
        setSaving(true)
        setError('')
        setNotice('')
        try {
          // No `session` query: the Host writes the profile default.
          await request('/save', { method: 'POST', body: JSON.stringify({ hidden: [...hidden].sort() }) })
          // Re-read this caller's view (keeping the draft) so the source pill
          // still says truthfully whether this conversation follows the default.
          await load(undefined, true)
          setNotice('已保存为默认：还没单独保存过的对话都用这套开关。')
          return true
        } catch (cause) {
          setError(`保存默认失败：${cause?.message ?? cause}`)
          return false
        } finally {
          setSaving(false)
        }
      }, [hidden, load])

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
        // The Host was reloaded from newer files than this already-open page:
        // the UI below is the previous version, so say that instead of silently
        // behaving like it.
        needsRefresh: data !== undefined && Number(data.codeVersion) !== CODE_VERSION,
        builtIn: data?.builtInScenarios ?? [],
        override: data?.session?.override === true,
        source: data?.source ?? 'global',
        // Which scheme the draft currently equals, so the selector can show it.
        selected: scenarioOf([...scenarios, ...(data?.builtInScenarios ?? [])], hidden),
        load, save, saveAsDefault, adopt, toggle, toggleGroup, applyScenario, saveAsScenario, removeScenario,
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
        h('div', { className: 'tsl-groups' }, slice.groups.map((group) => renderGroup(slice, group))),
        // A cold start can only see the root-registered tools; say so instead of
        // letting a preset-mount look like "the preset has no tools".
        slice.data?.inventorySource === 'global'
          ? h('p', { className: 'tsl-muted', style: { margin: '8px 0 0' } },
              '清单来自全局工具集：这个进程里还没有会话跑过一步。任意会话开始工作后，这里会自动补上该预设挂载的工具。')
          : null)
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
              // Saving the default is idempotent, so it stays available even when
              // the draft already equals it: a disabled "保存默认" reads as "this
              // is not editable", which is exactly the trap the panel had.
              disabled: !slice.ready || slice.saving,
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
      return '按需关闭工具定义，节省每次请求的工具定义 token；plan-act：先把任务拆成小步计划，再逐步交给子代理执行。'
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

    function chipModel(step) {
      const model = String(step?.model ?? '')
      if (model === '') return '继承'
      const short = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model
      return short.length > 16 ? `${short.slice(0, 15)}…` : short
    }

    function statusKey(status) {
      return ({ 待办: 'todo', 进行中: 'doing', 完成: 'done', 失败: 'failed', 已取消: 'cancelled' })[status] ?? 'todo'
    }

    /**
     * The deny list a permission profile means, for the tools this profile mounts.
     *
     * Mirrors `accessHidden` in core.mjs: the panel must show the same boxes the
     * child will really be missing, otherwise "只读" looks like "全部".
     * @param {string} access
     * @param {string[]} names every mounted tool name
     * @returns {string[]}
     */
    function denyForAccess(access, names) {
      if (access === '' || access === '全量') return []
      const keep = new Set(['read', 'glob', 'grep', 'ls'])
      const safeGroup = new Set(['fs_search', 'todo', 'ask', 'plan', 'step', 'jobs'])
      return names.filter((name) => {
        const group = name.split('_')[0]
        if (safeGroup.has(group)) return false
        if (access === '只读') return !keep.has(name)
        if (access === '读写') return !keep.has(name) && name !== 'write' && name !== 'edit' && name !== 'apply_patch'
        return false
      })
    }

    /** `工具 只读` / `工具 −3` / `工具 全部`: what the step really allows. */
    function toolLabel(step) {
      if (step.hidden.length > 0) return `工具 −${step.hidden.length}`
      if (step.access !== '') return `工具 ${step.access}`
      return '工具 全部'
    }

    /** `输出 1,234 tok · 12.3 tok/s · 1分40秒` for one step. */
    function formatStats(stat) {
      if (stat === undefined || stat === null || stat.calls === 0) return ''
      const seconds = Math.round(stat.ms / 1000)
      const span = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
      const tokens = stat.output >= 1000 ? `${(stat.output / 1000).toFixed(1)}k` : String(stat.output)
      return `输出 ${tokens} tok · ${stat.tps} tok/s · ${span}`
    }

    function stepRow(step, panel) {
      const routeValue = step.model === '' ? '' : step.model
      const known = panel.models.some((route) => route.models.some((model) => `${route.provider}/${model.id}` === routeValue))
      const options = [
        h('option', { value: '', key: 'inherit' }, '继承父会话'),
        ...panel.models.map((route) => h('optgroup', { label: route.name, key: `p-${route.provider}` },
          route.models.map((model) => h('option', { value: `${route.provider}/${model.id}`, key: `${route.provider}/${model.id}` },
            model.name)))),
        routeValue !== '' && !known
          ? h('option', { value: routeValue, key: 'current' }, `${routeValue}（不在当前列表）`)
          : null,
      ]
      const hidden = panel.toolDraft !== null && panel.toolDraft.step === step.n ? panel.toolDraft.hidden : null
      return h('li', { className: 'tsd-step', key: step.n, 'data-status': step.status },
        h('span', { className: 'tsd-step-n' }, step.n),
        h('span', {
          className: `tsd-step-status tsd-status-${statusKey(step.status)}`,
          title: step.status === '进行中' && step.startedAt !== '' ? `起于 ${step.startedAt}` : '',
        }, step.status),
        h('span', { className: 'tsd-step-title', title: step.task }, step.title),
        step.dependsOn.length === 0
          ? null
          : h('span', {
              className: 'tsd-dep',
              title: `要等第 ${step.dependsOn.join('、')} 步完成才能开始`,
            }, `依赖 ${step.dependsOn.join(',')}`),
        formatStats(panel.stats?.[String(step.n)]) === ''
          ? null
          : h('span', { className: 'tsd-stat', title: '这一步子代理的 token 用量、速度与耗时' },
              formatStats(panel.stats[String(step.n)])),
        h('div', { className: 'tsd-step-controls' },
          h('span', {
            className: `tsl-pill${step.access === '' ? '' : ' tsd-pill-access'}`,
            title: step.access === ''
              ? (step.hidden.length > 0 ? `自定义：关闭 ${step.hidden.length} 个工具` : '全量：不限制工具')
              : `规划时给定的权限：${step.access}`,
          }, step.access === '' ? (step.hidden.length > 0 ? `自定义 −${step.hidden.length}` : '全量') : step.access),
          h('select', {
            className: 'tsl-select',
            value: routeValue,
            disabled: panel.busy,
            title: '这一步用哪个模型执行',
            onChange: (event) => { void panel.writeStep(step.n, { model: event.target.value }) },
          }, options),
          h('button', {
            type: 'button',
            className: 'tsl-button',
            disabled: panel.busy,
            title: '这一步允许调用哪些工具',
            onClick: () => panel.toggleTools(step.n),
          }, toolLabel(step))),
        hidden === null ? null : h('div', { className: 'tsd-tools' },
          h('p', { className: 'tsd-note', style: { marginTop: 0 } },
            `第 ${step.n} 步可用工具（取消勾选＝这一步禁用该工具）：`),
          ...(panel.groups.length === 0
            ? [h('p', { className: 'tsd-note' }, '还没有工具清单：先在任意会话里跑一步，再回来。')]
            : panel.groups.map(panel.checklist(hidden, (next) => panel.setDraftHidden(step.n, next)))),
          h('div', { className: 'tsd-actions' },
            h('button', {
              type: 'button',
              className: 'tsl-button tsl-button-primary',
              disabled: panel.busy,
              onClick: () => { void panel.saveTools(step.n) },
            }, '保存这步的工具'),
            h('button', { type: 'button', className: 'tsl-button', onClick: () => panel.toggleTools(step.n) }, '收起'),
            h('button', {
              type: 'button',
              className: 'tsl-button',
              onClick: () => panel.setToolDraft(step.n, new Set()),
            }, '全部启用'))))
    }

    /**
     * The floating panel both dock entry points share.
     *
     * It opens upward over the transcript — the trigger sits at the bottom of the
     * screen, so a card that grew downward would cover the composer — capped by
     * the space that actually exists above the chip, and it closes on an outside
     * click or Escape exactly like the composer's own menus.
     * @param {string} open which panel is open (`''` when closed)
     * @param {() => void} close the caller's close handler
     * @param {'up' | 'down'} [side] which way the card grows
     * @returns {{rootRef: object, spaceAbove: number}}
     */
    function useDockPanel(open, close, side = 'up') {
      const rootRef = useRef(null)
      const [spaceAbove, setSpaceAbove] = useState(420)
      useEffect(() => {
        if (open === '') return undefined
        const measure = () => {
          const node = rootRef.current
          if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return
          const rect = node.getBoundingClientRect()
          // The composer dock hangs at the bottom of the window, so its card
          // grows up from the chip; the New Session row sits mid-screen above
          // the composer, so its card grows down instead of off the top edge.
          const room = side === 'up'
            ? rect.top - 16
            : (window.innerHeight || rect.bottom) - rect.bottom - 16
          setSpaceAbove(Math.max(200, Math.min(420, room)))
        }
        measure()
        window.addEventListener('resize', measure)
        return () => { window.removeEventListener('resize', measure) }
      }, [open])
      useEffect(() => {
        if (open === '') return undefined
        const onDown = (event) => {
          const node = rootRef.current
          if (node === null || node === undefined || typeof node.contains !== 'function') return
          if (!node.contains(event.target)) close()
        }
        const onKey = (event) => { if (event.key === 'Escape') close() }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open, close])
      return { rootRef, spaceAbove }
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
      const [showSteps, setShowSteps] = useState(true)
      const [models, setModels] = useState([])
      const [toolDraft, setToolDraftState] = useState(null)
      // The unified settings at the top of the panel: a permission profile plus a
      // tool checklist that can be saved as the default and pushed to every
      // unfinished step in one click.
      const [unified, setUnified] = useState(null)
      const [unifiedOpen, setUnifiedOpen] = useState(false)
      const [unifiedCollapsed, setUnifiedCollapsed] = useState(false)
      const [stepError, setStepError] = useState('')
      const pollRef = useRef(null)
      const aliveRef = useRef(true)
      const slice = useSlice({ auto: true, sessionId })
      const closePanel = useCallback(() => { writeOpen(''); setOpen('') }, [])
      const { rootRef, spaceAbove } = useDockPanel(open, closePanel)

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

      // While a step is running, keep the progress line current; the plan file is
      // written before the child starts and when its report lands. The `running`
      // flag comes from the Host, so a run started from the transcript also polls.
      useEffect(() => {
        if (open !== 'plan' || !(busy || (plan !== null && plan !== undefined && plan.running === true))) return undefined
        const timer = setInterval(() => { loadPlan() }, 2500)
        return () => { clearInterval(timer) }
      }, [open, busy, plan, loadPlan])

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
        // Open the panel before starting: the run's narration appears there, and a
        // user who clicked "execute" wants to watch it.
        if (open !== 'plan') { writeOpen('plan'); setOpen('plan') }
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

      /** Start every step whose dependencies are satisfied, side by side. */
      async function runParallel() {
        if (busy) return
        if (open !== 'plan') { writeOpen('plan'); setOpen('plan') }
        setBusy(true)
        try {
          await exec('/slice parallel')
        } finally {
          if (aliveRef.current) {
            setBusy(false)
            loadPlan()
          }
        }
      }

      /** Ask the model to run every remaining step in order, without stopping. */
      async function autoRun() {
        if (busy) return
        if (open !== 'plan') { writeOpen('plan'); setOpen('plan') }
        setBusy(true)
        try {
          await exec('/slice auto')
        } finally {
          if (aliveRef.current) {
            setBusy(false)
            loadPlan()
          }
        }
      }

      /**
       * Cancel the steps in flight. This aborts this session's plan run only, so
       * the model's turn keeps going and can still report what it saw.
       */
      async function stopAll() {
        setStatus('正在停止…')
        try {
          await exec('/slice stop')
        } finally {
          if (aliveRef.current) loadPlan()
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
            plan.approved
              ? (plan.current === null
                  ? ' ·已完成'
                  : ` ·第 ${plan.current.n} 步${plan.current.status === '进行中' ? ' 进行中' : ''} ·${chipModel(plan.current)}`)
              : ' ·待确认')

      const toolChip = h('button', {
        type: 'button',
        className: 'tsd-chip',
        'data-on': String(open === 'tools'),
        onClick: () => togglePanel('tools'),
        title: slice.needsRefresh
          ? '插件已在服务端更新，这个页面还在跑旧版：刷新一次浏览器页面即可用上新界面'
          : '关闭用不到的工具，减少每轮的工具定义 token',
      },
        h('span', { className: 'tsd-dot', 'aria-hidden': true }),
        '工具 ',
        h('b', null, slice.ready ? `${slice.enabledCount}/${slice.tools.length}` : '…'),
        slice.needsRefresh ? h('span', { className: 'tsd-pill-warn tsd-pill-access' }, '需刷新') : null)

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
              slice.needsRefresh ? h('p', { className: 'tsd-error' }, '插件已在服务端更新：刷新一次浏览器页面，就会出现完整的新界面（这个页面还停在旧版）。') : null,
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
              // Changing the profile default used to require the Plugins page.
              // It belongs here, next to the switches it describes.
              h('button', {
                type: 'button',
                className: 'tsl-button',
                disabled: !slice.ready || slice.saving,
                title: '把这套开关存成默认值：还没单独保存过的对话都用它（本对话自己的清单不变）',
                onClick: () => { void slice.saveAsDefault() },
              }, '存为默认'),
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

      // The model picker: every provider the LLM runtime serves. Fetched once
      // while the plan panel is open; a failure just leaves "inherit" available.
      useEffect(() => {
        if (open !== 'plan' || models.length > 0) return undefined
        const controller = new AbortController()
        fetch(`${ENDPOINT}/models`, { credentials: 'same-origin', signal: controller.signal })
          .then((response) => response.json())
          .then((data) => setModels(Array.isArray(data?.routes) ? data.routes : []))
          .catch(() => { /* the picker still offers "inherit" */ })
        return () => { controller.abort() }
      }, [open, models.length])

      const planSuffix = `?session=${encodeURIComponent(sessionId)}`

      /**
       * Write one step's model or tool policy. The whole plan comes back, so the
       * panel never merges a partial response and never guesses.
       * @param {number} step
       * @param {{model?: string, hidden?: string[]}} patch
       * @returns {Promise<boolean>}
       */
      const writeStep = useCallback(async (step, patch) => {
        if (sessionId === '') return false
        setStepError('')
        try {
          const data = await request(`/step${planSuffix}`, {
            method: 'POST',
            body: JSON.stringify({ step, ...patch }),
          })
          setPlan(data.plan)
          return true
        } catch (cause) {
          setStepError(`保存第 ${step} 步失败：${cause?.message ?? cause}`)
          return false
        }
      }, [planSuffix, sessionId])

      /** Confirm or withdraw the gate the model-facing step_run checks. */
      const setApproval = useCallback(async (approved) => {
        if (sessionId === '') return
        setStepError('')
        try {
          const data = await request(`/approve${planSuffix}`, {
            method: 'POST',
            body: JSON.stringify({ approved }),
          })
          setPlan(data.plan)
          setStatus(approved
            ? '已确认：这一步的模型和工具就按当前设定执行。'
            : '已取消确认：模型调用 step_run 会被拒绝，直到你再确认。')
        } catch (cause) {
          setStepError(`确认失败：${cause?.message ?? cause}`)
        }
      }, [planSuffix, sessionId])

      const setToolDraft = useCallback((step, hidden) => {
        setToolDraftState({ step, hidden: new Set(hidden) })
      }, [])

      /** Save the unified block as this profile's default step policy. */
      async function saveUnifiedAsDefault() {
        if (unified === null || sessionId === '') return
        const granular = unified.access === '' && unified.hidden.size > 0
        try {
          await request('/save', {
            method: 'POST',
            body: JSON.stringify({
              defaults: true,
              access: granular ? '' : unified.access,
              hidden: granular ? [...unified.hidden].sort() : [],
            }),
          })
          setStatus(granular
            ? `已设为默认：以后新建的步骤会关闭这 ${unified.hidden.size} 个工具。`
            : `已设为默认：以后新建的步骤按「${unified.access === '' ? '全量' : unified.access}」开始。`)
          loadPlan()
        } catch (cause) {
          setStepError(`保存默认设置失败：${cause?.message ?? cause}`)
        }
      }

      /** Push the unified block onto every step that is not finished yet. */
      async function applyUnifiedToAll() {
        if (unified === null || plan === null || plan === undefined || busy) return
        const granular = unified.access === '' && unified.hidden.size > 0
        const patch = granular
          ? { access: '', hidden: [...unified.hidden].sort() }
          : { access: unified.access, hidden: [] }
        // Finished steps keep their record and their policy; only pending work
        // is retargeted.
        const targets = plan.steps.filter((step) => step.status !== '完成')
        setBusy(true)
        setStepError('')
        try {
          for (const step of targets) await writeStep(step.n, patch)
          if (aliveRef.current) {
            setStatus(`已把统一设置应用到 ${targets.length} 个未完成步骤。`)
            loadPlan()
          }
        } finally {
          if (aliveRef.current) setBusy(false)
        }
      }

      /** Open or close one step's tool checklist. */
      const toggleTools = useCallback((step) => {
        setStepError('')
        setToolDraftState((draft) => {
          if (draft !== null && draft.step === step) return null
          const target = plan?.steps?.find((item) => item.n === step)
          const names = (slice.data?.groups ?? []).flatMap((group) => group.tools.map((tool) => tool.name))
          // A step that only carries a profile shows the boxes that profile really
          // denies; otherwise "应用了只读" would still look like everything is on.
          const seed = target !== undefined && target.hidden.length > 0
            ? target.hidden
            : denyForAccess(String(target?.access ?? ''), names)
          return { step, hidden: new Set(seed) }
        })
      }, [plan, slice.data])

      const saveTools = useCallback(async (step) => {
        const draft = toolDraft
        if (draft === null || draft.step !== step) return
        const ok = await writeStep(step, { hidden: [...draft.hidden].sort() })
        if (ok) setToolDraftState(null)
      }, [toolDraft, writeStep])

      /**
       * Build a checkbox renderer bound to one deny set: the step draft and the
       * unified block share it, so a tool means the same thing in both places.
       * @param {Set<string>} hidden denied tool names
       * @param {(next: Set<string>) => void} update
       */
      const renderChecklist = useCallback((hidden, update) => (group) => renderGroup({
        hidden,
        toggle: (name, on) => {
          const next = new Set(hidden)
          if (on) next.delete(name)
          else next.add(name)
          update(next)
        },
        toggleGroup: (target, on) => {
          const next = new Set(hidden)
          for (const tool of target.tools) {
            if (on) next.delete(tool.name)
            else next.add(tool.name)
          }
          update(next)
        },
      }, group), [])

      const stepPanel = {
        busy,
        models,
        groups: slice.data?.groups ?? [],
        stats: plan?.stats ?? {},
        toolDraft,
        writeStep,
        toggleTools,
        saveTools,
        setToolDraft,
        checklist: renderChecklist,
        setDraftHidden: (step, next) => {
          setToolDraftState((draft) => (draft !== null && draft.step === step ? { ...draft, hidden: next } : draft))
        },
      }

      // Seed the unified block from the profile default the first time a plan loads.
      useEffect(() => {
        if (unified !== null) return
        const defaults = plan?.defaults
        if (defaults === undefined) return
        setUnified({ access: String(defaults.access ?? ''), hidden: new Set(defaults.hidden ?? []) })
      }, [plan, unified])

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
            // One place to set the policy for the whole plan: the default for new
            // steps, and a single click to push it onto every unfinished step.
            unified === null ? null : unifiedCollapsed
              ? h('p', { className: 'tsd-note' },
                  h('button', {
                    type: 'button',
                    className: 'tsl-button',
                    style: { marginRight: '8px' },
                    onClick: () => setUnifiedCollapsed(false),
                  }, '展开统一步骤设置'),
                  `当前统一设置：${unified.access === '' ? '全量' : unified.access}${unified.hidden.size > 0 ? ` · 关闭 ${unified.hidden.size} 个工具` : ''}`)
              : h('div', { className: 'tsd-unified' },
              h('p', { className: 'tsd-note', style: { marginTop: 0 } },
                '统一步骤设置（默认权限 / 统一应用到全部步骤）'),
              h('div', { className: 'tsd-actions' },
                h('select', {
                  className: 'tsl-select',
                  value: unified.access,
                  title: '统一设置：每一步默认给多少权限',
                  onChange: (event) => setUnified({ ...unified, access: event.target.value }),
                },
                  h('option', { value: '全量' }, '全量（默认）'),
                  h('option', { value: '只读' }, '只读'),
                  h('option', { value: '读写' }, '读写')),
                h('button', {
                  type: 'button',
                  className: 'tsl-button',
                  title: '统一设置里逐项勾选要禁用的工具',
                  onClick: () => setUnifiedOpen(!unifiedOpen),
                }, unified.hidden.size > 0 ? `工具 −${unified.hidden.size}` : '工具 全部'),
                h('button', {
                  type: 'button',
                  className: 'tsl-button tsl-button-primary',
                  disabled: busy || plan.steps.filter((step) => step.status !== '完成').length === 0,
                  title: '把这套权限/工具设置写到每个未完成步骤上（已完成的步骤不动）',
                  onClick: () => { void applyUnifiedToAll() },
                }, '应用到全部步骤'),
                h('button', {
                  type: 'button',
                  className: 'tsl-button',
                  disabled: sessionId === '',
                  title: '保存成这个 profile 的默认值：以后 plan_write 新建的步骤都从这里开始',
                  onClick: () => { void saveUnifiedAsDefault() },
                }, '设为默认'),
                h('button', {
                  type: 'button',
                  className: 'tsl-button',
                  title: '收起这块统一设置',
                  onClick: () => { setUnifiedOpen(false); setUnifiedCollapsed(true) },
                }, '收起')),
              unifiedOpen
                ? h('div', { className: 'tsd-tools' },
                    ...(stepPanel.groups.length === 0
                      ? [h('p', { className: 'tsd-note' }, '还没有工具清单：先在任意会话里跑一步，再回来。')]
                      : stepPanel.groups.map(stepPanel.checklist(unified.hidden, (next) => setUnified({ ...unified, hidden: next })))),
                    h('div', { className: 'tsd-actions' },
                      h('button', { type: 'button', className: 'tsl-button', onClick: () => setUnifiedOpen(false) }, '收起'),
                      h('button', { type: 'button', className: 'tsl-button', onClick: () => setUnified({ access: '', hidden: new Set() }) }, '全部启用')))
                : null),
            h('p', { className: 'tsd-current' },
              `${plan.progress}${plan.revision > 1 ? ` · 第 ${plan.revision} 版` : ''}${plan.failed > 0 ? ` · 失败 ${plan.failed}` : ''}`,
              plan.current === null ? '' : `\n${plan.current.status === '进行中' ? '正在执行' : '下一步'}：第 ${plan.current.n} 步 ${plan.current.title}`
                + `（模型 ${plan.current.model === '' ? '继承父会话' : plan.current.model} · 权限 ${plan.current.access === '' ? (plan.current.hidden.length > 0 ? `自定义 −${plan.current.hidden.length}` : '全量') : plan.current.access}）`,
              plan.current === null ? '' : `\n` + (plan.current.status === '进行中' && plan.current.startedAt !== ''
                ? `起于 ${plan.current.startedAt}；如果这轮已经结束，点「重跑」继续。`
                : `做什么：${plan.current.task}`)),
            // The gate: nothing runs until this line is confirmed. Every step's
            // model and tool policy is set below, before confirming.
            h('div', { className: 'tsd-actions' },
              h('span', {
                className: `tsl-pill${plan.approved ? '' : ' tsd-pill-warn'}`,
                title: plan.approved ? `确认于 ${plan.approvedAt}` : '未确认：模型调用 step_run 会被拒绝',
              }, plan.approved ? `已确认 ${plan.approvedAt}` : '未确认'),
              plan.approved
                ? h('button', { type: 'button', className: 'tsl-button', disabled: busy, onClick: () => { void setApproval(false) } }, '取消确认')
                : h('button', {
                    type: 'button',
                    className: 'tsl-button tsl-button-primary',
                    disabled: busy || sessionId === '',
                    onClick: () => { void setApproval(true) },
                  }, '确认计划')),
            h('div', { className: 'tsd-actions' },
              h('button', {
                type: 'button',
                className: 'tsl-button tsl-button-primary',
                disabled: busy || plan.current === null || !plan.approved,
                title: plan.approved ? '执行下一个未完成步骤' : '先点「确认计划」',
                onClick: () => { void nextStep() },
              }, busy
                ? '执行中…'
                : (plan.current !== null && plan.current.status !== '待办' ? `重跑第 ${plan.current.n} 步` : '执行下一步')),
              // Automatic sequencing: after confirming, this is the one-click "run the rest".
              plan.approved && plan.ready > 0
                ? h('button', {
                    type: 'button',
                    className: 'tsl-button tsl-button-primary',
                    disabled: busy,
                    title: '让模型按顺序把剩下的步骤一次跑完，每步的报告仍会出现在对话里',
                    onClick: () => { void autoRun() },
                  }, busy ? '执行中…' : `自动顺次跑完剩余 ${plan.ready} 步`)
                : null,
              // Parallel work needs the human's say-so: the plan only marks which
              // steps are independent, and this button is that confirmation.
              plan.ready >= 2
                ? h('button', {
                    type: 'button',
                    className: 'tsl-button',
                    disabled: busy || !plan.approved,
                    title: `第 ${plan.readySteps.join('、')} 步互不依赖，可以同时跑`,
                    onClick: () => { void runParallel() },
                  }, `并行执行就绪 ${plan.ready} 步`)
                : null,
              plan.running || (plan.current !== null && plan.current.status === '进行中')
                ? h('button', {
                    type: 'button',
                    className: 'tsl-button tsd-danger',
                    title: '取消正在跑的步骤（标记为「已取消」，不算完成）',
                    onClick: () => { void stopAll() },
                  }, '停止全部')
                : null,
              h('button', { type: 'button', className: 'tsl-button', onClick: () => loadPlan() }, '刷新'),
              h('button', { type: 'button', className: 'tsl-button', onClick: () => setShowSteps(!showSteps) },
                showSteps ? '收起每一步' : `展开 ${plan.total} 步（模型/权限）`),
              h('button', { type: 'button', className: 'tsl-button', onClick: () => setPlan(undefined) }, '新建计划')),
            showSteps
              ? h('ol', { className: 'tsd-steps' }, plan.steps.map((step) => stepRow(step, stepPanel)))
              : h('p', { className: 'tsd-note' },
                  `共 ${plan.total} 步，点上面「展开」看每一步用哪个模型、哪些工具。`),
            stepError !== '' ? h('p', { className: 'tsd-error' }, stepError) : null,
            h('div', { style: { marginTop: 12, borderTop: '1px solid var(--dsw-alias-border-l3,#8884)', paddingTop: 10 } },
              h('p', { className: 'tsd-note', style: { marginTop: 0 } },
                '改计划就写在这里：模型会按你的意见重写整份计划，已完成的步骤、报告，以及你为各步设的模型/工具都会保留；改完需要重新确认。'),
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
              h('span', { className: 'tsd-pop-title' }, 'plan-act 计划'),
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

    /**
     * The compact switch chip beside the New Session composer.
     *
     * A conversation that has not sent its first message renders the composer in
     * its `hero` variant, and that variant does not render
     * `conversation.composer.dock` at all — so the switches used to be reachable
     * only after asking the model something. The New Session row
     * (`conversation.hero.options`) exists there instead, so one chip lives
     * there and edits the **profile default**, which is what a session with no
     * saved list of its own follows anyway. Once the first message lands the
     * composer switches to `composer` and the full dock takes over, so the two
     * never show at the same time.
     */
    function HeroDock() {
      // No session yet: this chip edits the default, which every new
      // conversation follows until it saves a list of its own.
      const slice = useSlice({ auto: true, sessionId: '' })
      const [open, setOpen] = useState(readOpen)
      const closePanel = useCallback(() => { writeOpen(''); setOpen('') }, [])
      const { rootRef, spaceAbove } = useDockPanel(open, closePanel, 'down')
      const toggle = () => {
        const next = open === 'tools' ? '' : 'tools'
        writeOpen(next)
        setOpen(next)
      }

      const chip = h('button', {
        type: 'button',
        className: 'tsd-chip',
        'data-on': String(open === 'tools'),
        title: slice.needsRefresh
          ? '插件已在服务端更新，这个页面还在跑旧版：刷新一次浏览器页面即可'
          : '默认工具开关：新会话都用这套，直到某个对话单独保存自己的清单',
        onClick: toggle,
      },
        h('span', { className: 'tsd-dot', 'aria-hidden': true }),
        '默认工具 ',
        h('b', null, slice.ready ? `${slice.enabledCount}/${slice.tools.length}` : '…'),
        slice.needsRefresh ? h('span', { className: 'tsd-pill-warn tsd-pill-access' }, '需刷新') : null)

      const panel = open === 'tools'
        ? h('div', { className: 'tsd-pop', style: { maxHeight: `${spaceAbove}px`, width: 'min(560px, calc(100vw - 24px))' } },
            h('div', { className: 'tsd-pop-head' },
              h('span', { className: 'tsd-pop-title' }, '默认工具开关'),
              h('span', { className: 'tsl-pill' }, '所有对话的起点'),
              h('button', { type: 'button', className: 'tsd-close', onClick: closePanel, 'aria-label': '收起' }, '×')),
            h('div', { className: 'tsd-pop-body' },
              statsRow(slice),
              scenarioRow(slice),
              board(slice),
              h('p', { className: 'tsd-note' },
                '这里改的是默认值：还没单独保存过的对话都跟着它。这个对话发出第一条消息后，'
                + '输入框下方会出现「工具」芯片，那时才能把它单独保存成这个对话的清单。'),
              slice.needsRefresh ? h('p', { className: 'tsd-error' }, '插件已在服务端更新：刷新一次浏览器页面，就会出现完整的新界面（这个页面还停在旧版）。') : null,
              slice.error !== '' ? h('p', { className: 'tsd-error' }, slice.error) : null),
            h('div', { className: 'tsd-pop-foot' },
              h('button', {
                type: 'button',
                className: 'tsl-button tsl-button-primary',
                disabled: !slice.ready || slice.saving,
                onClick: () => { void slice.saveAsDefault() },
              }, slice.saving ? '保存中…' : '保存默认'),
              h('button', {
                type: 'button',
                className: 'tsl-button',
                disabled: !slice.ready || slice.saving || !slice.dirty,
                onClick: () => { slice.adopt(slice.data); slice.setNotice('') },
              }, '撤销'),
              h('span', { className: 'tsl-status' }, slice.saving ? '保存中…' : slice.notice)))
        : null

      return h('div', { className: 'tsd tsd-hero', ref: rootRef },
        h('style', null, css),
        chip,
        panel)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        /**
         * Mount one surface on its own.
         *
         * A page that rejects or lacks one slot must not lose the rest: an
         * Android WebView was seen to stop a bare `apply` right after the first
         * `slots.inject`, which left the user with no tool bar at all and no
         * visible reason. Each entry is therefore independent, and a failure is
         * reported on the console instead of aborting the others.
         * @param {string} label what failed, for the console
         * @param {() => void} mount the registration call
         */
        const surface = (label, mount) => {
          try {
            mount()
          } catch (error) {
            try {
              console.error(`[tool-slice] ${label} 注册失败（其余面板继续）`, error)
            } catch {
              /* a page without console must still keep going */
            }
          }
        }
        surface('插件页配置卡', () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: NS },
          (props) => (props?.view === 'summary' ? summaryText() : h(ToolSliceCard, null)),
        )))
        // The command channel is optional: a page without the remote service
        // still renders the switches and reports the missing channel.
        let executeCommand
        if (typeof ctx.inject === 'function') {
          surface('指令通道', () => ctx.inject(['remote', 'remote.commands'], (scope) => {
            const commands = scope?.remote?.commands
            if (commands !== undefined && typeof commands.execute === 'function') {
              executeCommand = (sessionId, line) => commands.execute(sessionId, line, [])
            }
          }))
        }
        // The composer dock is where a user looks while talking; the page stays
        // for a full edit, the dock for a one-click switch.
        surface('输入框下工具条', () => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'tool-slice-dock',
          order: 20,
          inject: (sessionId) => ({
            sessionId: String(sessionId ?? ''),
            run: (line) => executeCommand === undefined
              ? Promise.reject(new Error('这个页面没有指令通道（remote.commands 不可用），请重启 DSH 让插件生效'))
              : executeCommand(sessionId, line),
          }),
        }, SliceDock)))
        // A brand-new conversation renders the composer in its `hero` variant,
        // which never renders `conversation.composer.dock`: without this second
        // entry the switches are unreachable until the first message exists.
        // Both entries are a list slot the owner renders in mutually exclusive
        // variants, so they are never on screen together.
        surface('新会话默认工具条', () => ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
          name: 'conversation.hero.options',
          id: 'tool-slice-hero',
          order: 20,
        }, HeroDock)))
      },
    }
  },
})