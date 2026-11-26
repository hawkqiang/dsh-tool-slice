import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

/** Load client.js the way the browser module table does. */
function loadClient() {
  const loaded = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: () => ({ current: true }),
  }
  const context = {
    console,
    window: {
      __ModuleLoader__: {
        load: (entry) => { loaded.push(entry) },
      },
    },
    fetch: async () => { throw new Error('not used') },
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  assert.equal(loaded.length, 1, 'client registers exactly one module')
  const entry = loaded[0]
  assert.equal(entry.id, manifest.name)
  const exported = entry.factory((id) => {
    assert.equal(id, 'react')
    return React
  })
  return { exported }
}

/** A context shaped like the browser plugin context this module uses. */
function fakeContext() {
  const registrations = []
  const injected = []
  const commands = []
  const ctx = {
    slots: {
      inject: (name, callback) => {
        injected.push(name)
        callback()
      },
      register: (options, renderer) => { registrations.push({ options, renderer }); return () => {} },
    },
    inject: (deps, callback) => { callback({ ...ctx, remote: { commands: { execute: async (...args) => { commands.push(args); return { ok: true, value: { kind: 'success', text: 'ok' } } } } } }) },
  }
  return { ctx, registrations, injected, commands }
}

test('client module registers one factory under the package name', () => {
  const { exported } = loadClient()
  assert.deepEqual([...exported.inject], ['slots'])
  assert.equal(typeof exported.apply, 'function')
})

test('apply registers the bundle page, the composer dock and the New Session chip', () => {
  const { exported } = loadClient()
  const fake = fakeContext()
  exported.apply(fake.ctx)
  assert.deepEqual(fake.injected, ['plugins.bundle.config', 'conversation.composer.dock', 'conversation.hero.options'])
  assert.equal(fake.registrations.length, 3)
  const [page, dock, hero] = fake.registrations
  assert.equal(page.options.name, 'plugins.bundle.config')
  assert.equal(page.options.key, manifest.name)
  assert.equal(dock.options.name, 'conversation.composer.dock')
  assert.equal(dock.options.id, 'tool-slice-dock')
  assert.equal(typeof dock.renderer, 'function')
  // A conversation without a first message renders the composer in its hero
  // variant, which never renders `conversation.composer.dock`; the New Session
  // row needs its own entry or the switches are unreachable there.
  assert.equal(hero.options.name, 'conversation.hero.options')
  assert.equal(hero.options.id, 'tool-slice-hero')
  assert.equal(typeof hero.renderer, 'function')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
})

test('the dock injects a session id and runs /slice through the command channel', async () => {
  const { exported } = loadClient()
  const fake = fakeContext()
  exported.apply(fake.ctx)
  const dock = fake.registrations[1]
  assert.equal(typeof dock.options.inject, 'function')
  const props = dock.options.inject('s-abc')
  assert.equal(props.sessionId, 's-abc')
  const result = await props.run('/slice next')
  assert.deepEqual(result, { ok: true, value: { kind: 'success', text: 'ok' } })
  assert.equal(fake.commands.length, 1)
  const [session, line, attachments] = fake.commands[0]
  assert.equal(session, 's-abc')
  assert.equal(line, '/slice next')
  assert.equal(attachments.length, 0)
})

test('the summary view renders a short string without touching the network', () => {
  const { exported } = loadClient()
  const fake = fakeContext()
  exported.apply(fake.ctx)
  const page = fake.registrations[0]
  const summary = page.renderer({ view: 'summary' })
  assert.equal(typeof summary, 'string')
  assert.ok(summary.length > 0 && summary.length < 200)
  const view = page.renderer({ view: 'page' })
  assert.equal(typeof view, 'object')
  assert.equal(typeof view.type, 'function', 'the page view mounts the card component')
})
test('one slot that rejects the page does not take the other two down', () => {
  // An Android WebView was seen to stop a bare apply right after the first
  // slots.inject, leaving no tool bar and no visible reason. Each surface is
  // registered independently so a page that lacks or refuses one slot still
  // gets the rest.
  const { exported } = loadClient()
  const fake = fakeContext()
  fake.ctx.slots.inject = (name, callback) => {
    fake.injected.push(name)
    if (name === 'plugins.bundle.config') throw new Error('this page has no bundle page')
    callback()
  }
  exported.apply(fake.ctx)
  assert.deepEqual(fake.injected, ['plugins.bundle.config', 'conversation.composer.dock', 'conversation.hero.options'])
  assert.equal(fake.registrations.length, 2, 'the dock and the New Session chip still registered')
  assert.deepEqual(fake.registrations.map((entry) => entry.options.name), ['conversation.composer.dock', 'conversation.hero.options'])
})
