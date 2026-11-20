import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('manifest exports and files exist', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const target of Object.values(manifest.exports)) {
    if (target.includes('*')) continue
    assert.ok(fs.existsSync(path.join(root, target)), `export target missing: ${target}`)
  }
  for (const entry of manifest.files) {
    if (entry.includes('*')) {
      const dir = path.join(root, path.dirname(entry))
      assert.ok(fs.existsSync(dir), `files directory missing: ${dir}`)
      continue
    }
    assert.ok(fs.existsSync(path.join(root, entry)), `files entry missing: ${entry}`)
  }
})

test('the client registers the bundle config page under the package name', () => {
  const manifest = JSON.parse(read('package.json'))
  const client = read('client.js')
  assert.match(client, new RegExp(`id: '${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  assert.match(client, /name: 'plugins\.bundle\.config'/)
  assert.match(client, new RegExp(`key: NS`))
  assert.match(client, new RegExp(`const NS = '${manifest.name}'`))
})

test('the patch inserts the host row and the lean preset', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /- id: tool-slice\n\s+name: '@local\/dsh-tool-slice'/)
  assert.match(patch, /- id: preset-lean\n\s+name: '@deepseek-ai\/dsh-agent-preset'/)
  assert.match(patch, /id: lean/)
  assert.match(patch, /'@local\/dsh-tool-slice\/step-tools'/)
  assert.match(patch, /'@deepseek-ai\/dsh-compaction-basic'/)
  const manifest = JSON.parse(read('package.json'))
  assert.equal(patch.includes(`'${manifest.name}/step-tools'`), true)
})

test('the patch names no unknown local export', () => {
  const manifest = JSON.parse(read('package.json'))
  const patch = read('cordis.patch.yml')
  const localRefs = [...patch.matchAll(/'(@local\/[^']+)'/g)].map((match) => match[1])
  for (const ref of localRefs) {
    if (ref === manifest.name) continue
    assert.ok(ref.startsWith(`${manifest.name}/`), `unexpected local package in patch: ${ref}`)
    const suffix = `./${ref.slice(manifest.name.length + 1)}`
    assert.ok(manifest.exports[suffix] !== undefined, `export missing for patch reference: ${ref}`)
  }
})

test('locales parse and carry display metadata', () => {
  for (const locale of ['zh', 'en']) {
    const data = JSON.parse(read(`locale/${locale}.json`))
    assert.equal(typeof data.meta.title, 'string')
    assert.ok(data.meta.title.length > 0)
    assert.equal(typeof data.meta.description, 'string')
    assert.ok(data.meta.description.length > 0)
  }
})

test('the icon is a well-formed SVG image', () => {
  const svg = read('icon.svg')
  assert.match(svg, /^<svg[\s>]/)
  assert.match(svg, /<\/svg>\s*$/)
  assert.match(svg, /viewBox="0 0 64 64"/)
  assert.ok(Buffer.byteLength(svg) < 256 * 1024)
})
