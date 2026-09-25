import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createReadNotebookTool, inject, TOOL_NAME } from '../lib/index.js'

const sampleText = readFileSync(fileURLToPath(new URL('./fixtures/sample.ipynb', import.meta.url)), 'utf8')

/** A composed-filesystem stand-in that serves one file from one cwd. */
function fakeCtx({ text = sampleText, bytes } = {}) {
  return {
    fs: {
      async resolve(path, options) {
        assert.equal(options.cwd, '/work')
        return { path, cwd: options.cwd }
      },
      async readBytes() {
        if (bytes !== undefined) return bytes
        return new TextEncoder().encode(text)
      }
    }
  }
}

const exec = { signal: undefined, agent: { session: { header: { cwd: '/work' } } } }

test('the tool declares the wire contract the card is keyed by', () => {
  const tool = createReadNotebookTool(fakeCtx())
  assert.equal(tool.name, 'read_notebook')
  assert.equal(tool.name, TOOL_NAME)
  assert.deepEqual(tool.parameters.required, ['file_path'])
  assert.equal(tool.parameters.properties.file_path.type, 'string')
  assert.deepEqual(tool.output.schema, { type: 'string' })
  assert.deepEqual(inject, ['tools', 'fs'])
})

test('execute returns a bounded digest of the notebook', async () => {
  const tool = createReadNotebookTool(fakeCtx())
  const value = await tool.execute({ file_path: 'notebooks/demo.ipynb' }, exec)
  const digest = JSON.parse(value)
  assert.equal(digest.v, 1)
  assert.equal(digest.path, 'notebooks/demo.ipynb')
  assert.equal(digest.cellCount, 8)
  assert.equal(digest.cells.length, 8)
  assert.equal(digest.language, 'python')
  assert.equal(digest.truncated, false)
  const figure = digest.cells.find((cell) => cell.i === 4)
  assert.equal(figure.outputs[0].mime, 'image/png')
})

test('render produces model text with no base64 and honours max_chars', async () => {
  const tool = createReadNotebookTool(fakeCtx())
  const value = await tool.execute({ file_path: 'demo.ipynb' }, exec)
  const blocks = tool.output.render({ file_path: 'demo.ipynb' }, value)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /^<notebook cells="8"/)
  assert.equal(blocks[0].text.includes('iVBORw0KGgo'), false)

  const short = tool.output.render({ max_chars: 150 }, value)
  assert.equal(short[0].text.length < blocks[0].text.length, true)
})

test('presentationMeta carries the digest for the card', async () => {
  const tool = createReadNotebookTool(fakeCtx())
  const value = await tool.execute({ file_path: 'demo.ipynb' }, exec)
  const meta = tool.output.presentationMeta({}, value)
  assert.equal(meta.v, 1)
  assert.equal(meta.cells.length, 8)
  assert.equal(tool.output.presentationMeta({}, 'not json'), null)
})

test('the cells selector narrows the digest', async () => {
  const tool = createReadNotebookTool(fakeCtx())
  const value = await tool.execute({ file_path: 'demo.ipynb', cells: '1,3-4' }, exec)
  const digest = JSON.parse(value)
  assert.deepEqual(digest.cells.map((cell) => cell.i), [1, 3, 4])
  assert.equal(digest.cellCount, 8)
})

test('include_outputs:false drops every output', async () => {
  const tool = createReadNotebookTool(fakeCtx())
  const value = await tool.execute({ file_path: 'demo.ipynb', include_outputs: false }, exec)
  for (const cell of JSON.parse(value).cells) {
    assert.deepEqual(cell.outputs ?? [], [])
  }
})

test('every failure mode is a thrown Error with a readable reason', async () => {
  const tool = createReadNotebookTool(fakeCtx())

  await assert.rejects(() => tool.execute({}, exec), /file_path must be a non-empty string/)
  await assert.rejects(() => tool.execute({ file_path: '   ' }, exec), /file_path must be a non-empty string/)
  await assert.rejects(
    () => tool.execute({ file_path: 'demo.ipynb' }, { signal: undefined, agent: { session: { header: {} } } }),
    /no working directory/
  )

  const unreadable = {
    fs: {
      async resolve(path) {
        return { path }
      },
      async readBytes() {
        throw new Error('FS_NOT_REGULAR_FILE')
      }
    }
  }
  await assert.rejects(
    () => createReadNotebookTool(unreadable).execute({ file_path: 'demo.ipynb' }, exec),
    /could not read demo\.ipynb: FS_NOT_REGULAR_FILE/
  )

  const empty = createReadNotebookTool(fakeCtx({ text: '' }))
  await assert.rejects(() => empty.execute({ file_path: 'demo.ipynb' }, exec), /is empty/)

  const broken = createReadNotebookTool(fakeCtx({ text: '{ not json' }))
  await assert.rejects(() => broken.execute({ file_path: 'demo.ipynb' }, exec), /not a readable notebook: not valid JSON/)

  const binary = createReadNotebookTool(fakeCtx({ bytes: new Uint8Array([0xff, 0xfe, 0x00]) }))
  await assert.rejects(() => binary.execute({ file_path: 'demo.ipynb' }, exec), /not valid UTF-8/)

  await assert.rejects(
    () => tool.execute({ file_path: 'demo.ipynb', cells: '99' }, exec),
    /matched none of the 8 cells/
  )
})

test('a filesystem refusal is reported with the tool’s own prefix', async () => {
  const ctx = {
    fs: {
      async resolve() {
        throw new Error('FS_DENIED: outside the workspace')
      }
    }
  }
  const tool = createReadNotebookTool(ctx)
  await assert.rejects(() => tool.execute({ file_path: '../escape.ipynb' }, exec), /could not resolve \.\.\/escape\.ipynb: FS_DENIED/)
})
