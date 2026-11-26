#!/usr/bin/env node
/**
 * Diagnose the plan-act preset against **this** DSH installation.
 *
 * A preset row that fails activation makes the whole preset read 「加载失败」 in
 * the picker, and the UI only shows that one word. This script reproduces the
 * activation-time config check row by row and prints the exact reason, so a
 * missing required field or an unresolvable package name is visible without a
 * debugger.
 *
 * Usage (inside a DSH session, where DSH_INSTALL_DIR is set):
 *   node scripts/check-preset.mjs
 *   DSH_INSTALL_DIR=/path/to/node_modules/@deepseek-ai/dsh node scripts/check-preset.mjs
 *
 * Exits 1 when a row is invalid, so it can gate a release.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** The DSH installation whose plugins the preset mounts. */
function installRoot() {
  const candidates = [process.env.DSH_INSTALL_DIR]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') {
      // DSH_INSTALL_DIR points at .../node_modules/@deepseek-ai/dsh; the plugin
      // packages sit beside it in node_modules.
      return path.dirname(path.dirname(candidate))
    }
  }
  throw new Error('set DSH_INSTALL_DIR (…/node_modules/@deepseek-ai/dsh) to the installation to check against')
}

const nodeModules = installRoot()
const require = createRequire(path.join(nodeModules, 'noop.js'))
const yaml = require('js-yaml')

/**
 * Evaluate one `!!js` expression the way the Loader does, so a `disabled` row is
 * classified for this platform instead of always skipped.
 * @param {string} text
 */
function evaluate(text) {
  try {
    return new Function('ctx', 'process', `with (ctx) { return (${text}) }`)({ get: () => undefined }, process)
  } catch {
    return undefined
  }
}

const patch = yaml.load(fs.readFileSync(path.join(repo, 'cordis.patch.yml'), 'utf8'), {
  schema: yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    construct: (data) => evaluate(String(data)),
  })]),
})

const preset = patch.flatMap((layer) => layer.insert ?? []).find((row) => row.id === 'preset-plan-act')
if (preset === undefined) throw new Error('cordis.patch.yml declares no preset-plan-act row')
console.log(`preset ${preset.config.id} · ${preset.config.plugins.length} rows · checking against ${nodeModules}`)

/** @param {string} name */
function entryOf(name) {
  if (name.startsWith('@local/dsh-tool-slice')) return path.join(repo, 'step-tools.js')
  const dir = path.join(nodeModules, name)
  if (!fs.existsSync(dir)) return undefined
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  return path.join(dir, manifest.module ?? manifest.main ?? 'index.js')
}

/**
 * Group rows are structural: only their children are plugins.
 * @param {Array<object>} rows
 * @param {Array<object>} out
 */
function flatten(rows, out = []) {
  for (const row of rows ?? []) {
    if (row.group === true) { flatten(row.config, out); continue }
    out.push(row)
  }
  return out
}

let failed = 0
for (const row of flatten(preset.config.plugins)) {
  const label = `${row.id} (${row.name})`
  if (row.disabled === true) {
    console.log(`- ${label}: disabled on this platform, skipped`)
    continue
  }
  const file = entryOf(row.name)
  if (file === undefined) {
    failed++
    console.log(`- ${label}: PACKAGE NOT FOUND in ${nodeModules}`)
    continue
  }
  let mod
  try {
    mod = await import(`file://${file}`)
  } catch (error) {
    failed++
    console.log(`- ${label}: import failed: ${error.message}`)
    continue
  }
  if (mod.Config === undefined) {
    console.log(`- ${label}: ok (no config schema)`)
    continue
  }
  try {
    mod.Config(row.config ?? {})
    console.log(`- ${label}: ok`)
  } catch (error) {
    failed++
    console.log(`- ${label}: INVALID CONFIG -> ${error.message}`)
  }
}
console.log(failed === 0 ? '\nall preset rows valid on this installation' : `\n${failed} row(s) invalid`)
process.exit(failed === 0 ? 0 : 1)