/**
 * Stamp `metadata.execution` onto `sample.ipynb`'s code cells.
 *
 * The preview shows a cell's run time when the notebook recorded it, and the fixture
 * had no timestamps at all — so the feature existed but was invisible in the notebook
 * most likely to be opened. Each code cell gets a distinct duration, written the way
 * Jupyter writes it: microsecond precision with a `Z` suffix.
 *
 * Run:  node test/fixtures/add-execution-times.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const target = fileURLToPath(new URL('sample.ipynb', import.meta.url))
const base = Date.parse('2026-01-06T09:15:00.000Z')

/** A Jupyter-style stamp: milliseconds of offset, rendered with microseconds. */
const stamp = (offsetMs) => new Date(base + offsetMs).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z')

/** `[start offset, duration]` per code cell, in document order. */
const RUNS = [
  [1000, 300],
  [4000, 1200],
  [6400, 2800],
  [11000, 12400],
  [25000, 640],
  [27000, 95]
]

const notebook = JSON.parse(readFileSync(target, 'utf8'))
let at = 0
for (const cell of notebook.cells) {
  if (cell.cell_type !== 'code') continue
  const [start, duration] = RUNS[at] ?? [30000, 100]
  const input = stamp(start)
  cell.metadata = cell.metadata ?? {}
  cell.metadata.execution = {
    'iopub.execute_input': input,
    'iopub.status.busy': input,
    'shell.execute_reply': stamp(start + duration)
  }
  at += 1
}
writeFileSync(target, `${JSON.stringify(notebook, null, 1)}\n`, 'utf8')

for (const cell of notebook.cells) {
  if (cell.cell_type !== 'code') continue
  const execution = cell.metadata.execution
  const ms = Date.parse(execution['shell.execute_reply']) - Date.parse(execution['iopub.execute_input'])
  console.log(`  ${String(cell.source).trim().split('\n')[0].slice(0, 24)} -> ${ms} ms`)
}
console.log(`stamped ${at} code cells in sample.ipynb`)
