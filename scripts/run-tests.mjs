/**
 * Run every `test/*.test.mjs` in this process.
 *
 * `node --test` is not usable here: it spawns one child per test file with
 * piped stdio, which the DSH file sandbox denies with `EPERM` (named pipes are
 * unavailable inside the confined modes). Importing the files directly runs the
 * same `node:test` suites in-process and reports through the same TAP printer.
 */
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const testDir = fileURLToPath(new URL('../test/', import.meta.url))
const entries = await readdir(testDir)
const files = entries.filter((name) => name.endsWith('.test.mjs')).sort()

if (files.length === 0) {
  console.error('no test/*.test.mjs files found')
  process.exit(1)
}

for (const file of files) {
  await import(new URL(`../test/${file}`, import.meta.url).href)
}
