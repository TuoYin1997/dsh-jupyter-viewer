import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  ANSI_PALETTE,
  LIMITS,
  RICH_MIME_PRIORITY,
  attachmentDataUrl,
  base64ByteLength,
  buildDigest,
  buildToolText,
  capText,
  cellSearchText,
  collapseCarriageReturns,
  describeDigestOutput,
  digestSummary,
  executionDuration,
  fileMediaUrl,
  findCells,
  formatDuration,
  highlightRuns,
  imageDataUrl,
  isAbsoluteWorkspacePath,
  imageIsConstrained,
  isImageMime,
  joinSource,
  markdownImageUrl,
  normalizeCell,
  normalizeNotebook,
  normalizeOutput,
  notebookOutline,
  parseAnsiSpans,
  parseCellSelector,
  parseNotebook,
  pathPartsOf,
  rawViewText,
  relativeImageDestinations,
  selectCells,
  selectDataMime,
  stripAnsi,
  tableToTsv,
  upconvertNbformat3
} from '../src/notebook.js'

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

const sampleText = fixture('sample.ipynb')
const sample = parseNotebook(sampleText)

test('stripAnsi removes CSI, OSC and short escapes', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(stripAnsi('\u001b]0;title\u0007after'), 'after')
  assert.equal(stripAnsi('plain'), 'plain')
  assert.equal(stripAnsi(undefined), '')
})

test('joinSource joins arrays and tolerates missing values', () => {
  assert.equal(joinSource('a\nb'), 'a\nb')
  assert.equal(joinSource(['a\n', 'b']), 'a\nb')
  assert.equal(joinSource(undefined), '')
  assert.equal(joinSource([1, 'b']), 'b')
})

test('base64ByteLength counts decoded bytes without whitespace or padding', () => {
  assert.equal(base64ByteLength(''), 0)
  assert.equal(base64ByteLength('TQ=='), 1)
  assert.equal(base64ByteLength('TWE='), 2)
  assert.equal(base64ByteLength('TWFu'), 3)
  assert.equal(base64ByteLength('TW\nFu'), 3)
})

test('selectDataMime applies the documented priority', () => {
  assert.equal(selectDataMime({ 'text/plain': 'x', 'image/png': 'y' }), 'image/png')
  assert.equal(selectDataMime({ 'text/plain': 'x', 'text/html': 'y' }), 'text/html')
  assert.equal(selectDataMime({ 'text/plain': 'x' }), 'text/plain')
  assert.equal(selectDataMime({ 'application/x-weird': 1 }), 'application/x-weird')
  assert.equal(selectDataMime({}), undefined)
  assert.equal(selectDataMime(null), undefined)
  assert.equal(RICH_MIME_PRIORITY[0], 'text/html')
})

test('isImageMime recognizes raster and vector images', () => {
  assert.equal(isImageMime('image/png'), true)
  assert.equal(isImageMime('image/svg+xml'), true)
  assert.equal(isImageMime('text/html'), false)
  assert.equal(isImageMime(undefined), false)
})

test('normalizeOutput covers every nbformat output type', () => {
  assert.deepEqual(normalizeOutput({ output_type: 'stream', name: 'stdout', text: ['a\n'] }), {
    kind: 'stream',
    name: 'stdout',
    text: 'a\n'
  })
  assert.equal(normalizeOutput({ output_type: 'stream', name: 'stderr', text: 'x' }).name, 'stderr')

  const error = normalizeOutput({ output_type: 'error', ename: 'E', evalue: 'boom', traceback: ['\u001b[31mE: boom'] })
  assert.equal(error.kind, 'error')
  assert.equal(error.name, 'E')
  assert.equal(error.value, 'boom')
  assert.equal(error.text, 'E: boom')

  assert.equal(normalizeOutput({ output_type: 'execute_result', data: { 'text/plain': '42' } }).kind, 'text')
  assert.equal(normalizeOutput({ output_type: 'display_data', data: { 'text/html': '<b>x</b>' } }).kind, 'html')
  assert.equal(normalizeOutput({ output_type: 'display_data', data: { 'image/png': 'TQ==' } }).bytes, 1)
  assert.equal(normalizeOutput({ output_type: 'display_data', data: { 'image/svg+xml': '<svg/>' } }).svg, '<svg/>')
  assert.equal(normalizeOutput({ output_type: 'display_data', data: { 'application/json': [1, 2] } }).kind, 'json')
  assert.equal(normalizeOutput({ output_type: 'display_data', data: {} }).kind, 'unsupported')
  assert.equal(normalizeOutput({ output_type: 'nope' }).kind, 'unsupported')
  assert.equal(normalizeOutput(null).kind, 'unsupported')
})

test('parseNotebook accepts a real notebook and derives its metadata', () => {
  assert.equal(sample.ok, true)
  assert.equal(sample.notebook.nbformat, 4)
  assert.equal(sample.notebook.nbformatMinor, 5)
  assert.equal(sample.notebook.language, 'python')
  assert.equal(sample.notebook.kernel, 'Python 3 (ipykernel)')
  assert.equal(sample.notebook.cellCount, 8)
  assert.deepEqual(
    sample.notebook.cells.map((cell) => cell.kind),
    ['markdown', 'code', 'code', 'code', 'code', 'code', 'raw', 'code']
  )
  assert.equal(sample.notebook.cells[0].source.startsWith('# Demo notebook'), true)
  assert.equal(sample.notebook.cells[1].outputs.length, 2)
  assert.equal(sample.notebook.cells[5].executionCount, null)
})

test('parseNotebook reports a usable reason for every rejected file', () => {
  const malformed = parseNotebook(fixture('malformed.ipynb'))
  assert.equal(malformed.ok, false)
  assert.match(malformed.error, /not valid JSON/)

  const noCells = parseNotebook(fixture('no-cells.ipynb'))
  assert.equal(noCells.ok, false)
  assert.match(noCells.error, /no cells array/)

  const old = parseNotebook(fixture('nbformat3.ipynb'))
  assert.equal(old.ok, true, 'an nbformat 3 notebook is up-converted instead of refused')

  assert.equal(parseNotebook('').ok, false)
  assert.equal(parseNotebook('[]').ok, false)
  assert.equal(parseNotebook('"text"').ok, false)
})

test('an nbformat 3 notebook is read through, not refused', () => {
  // It still opens in Jupyter, so refusing it hides a readable file behind a message.
  const old = parseNotebook(fixture('nbformat3.ipynb'))
  assert.equal(old.ok, true)
  const cells = old.notebook.cells
  assert.equal(cells.length, 5)
  // `worksheets[].cells` is flattened, and a heading becomes markdown heading syntax.
  assert.equal(cells[0].source, '# An nbformat 3 notebook')
  assert.equal(cells[1].kind, 'markdown')
  assert.match(cells[1].source, /worksheets/)
  // A code cell's source is `input`, its prompt is `prompt_number`.
  assert.equal(cells[2].source, "print('hello from v3')\n")
  assert.equal(cells[2].executionCount, 1)
  assert.equal(cells[2].outputs[0].kind, 'stream')
  // `pyout` is an execute_result.
  assert.equal(cells[3].outputs[0].text, '42')
  // `pyerr` is an error, and keeps its colored traceback.
  assert.equal(cells[4].outputs[0].kind, 'error')
  assert.equal(cells[4].outputs[0].name, 'ValueError')
  assert.equal(cells[4].outputs[0].ansi.includes('\u001B'), true)
  // v3 metadata supplies the kernel.
  assert.equal(old.notebook.kernel, 'Old notebook')
  assert.equal(old.notebook.language, 'python')
  // A v3 file with nothing to convert is still refused, with a readable reason.
  const empty = parseNotebook('{"nbformat":3,"worksheets":[]}')
  assert.equal(empty.ok, false)
  assert.match(empty.error, /unsupported nbformat 3/)
  // A version with no usable number is refused too.
  assert.equal(parseNotebook('{"cells":[]}').ok, false)
  assert.equal(parseNotebook('{').ok, false)
})

test('upconvertNbformat3 maps the shapes a v3 file can carry', () => {
  const converted = upconvertNbformat3({
    nbformat: 3,
    metadata: { name: 'k', language: 'python' },
    worksheets: [
      {
        cells: [
          { cell_type: 'raw', source: ['raw\n'] },
          {
            cell_type: 'code',
            input: 'plot()\n',
            prompt_number: 7,
            outputs: [
              { output_type: 'display_data', data: { 'text/html': '<b>h</b>' } },
              { output_type: 'display_data', png: 'QUJD' },
              { output_type: 'unknown_type' }
            ]
          },
          { cell_type: 'code', input: 'x', outputs: [{ output_type: 'pyerr', ename: 'E', evalue: 'v', traceback: 'one line' }] }
        ]
      }
    ]
  })
  assert.equal(converted.nbformat, 4)
  const cells = converted.cells
  assert.equal(cells[0].cell_type, 'raw')
  assert.equal(cells[0].source, 'raw\n')
  assert.equal(cells[1].outputs.length, 2, 'an unknown output type is dropped')
  assert.deepEqual(cells[1].outputs[1].data, { 'image/png': 'QUJD' })
  // A string traceback becomes the single-line array v4 uses.
  assert.deepEqual(cells[2].outputs[0].traceback, ['one line'])
  // A heading level beyond the markdown range is clamped, not repeated further.
  const heading = upconvertNbformat3({ worksheets: [{ cells: [{ cell_type: 'heading', level: 9, source: 'x' }] }] })
  assert.equal(heading.cells[0].source, '###### x')
  // Cells at the top level, as some writers emitted, are accepted.
  const flat = upconvertNbformat3({ nbformat: 3, cells: [{ cell_type: 'markdown', source: 'top' }] })
  assert.equal(flat.cells.length, 1)
  assert.equal(upconvertNbformat3(null), undefined)
  assert.equal(upconvertNbformat3({ nbformat: 3, worksheets: [] }), undefined)
})

test('capText reports truncation', () => {
  assert.deepEqual(capText('abcd', 10), { text: 'abcd', truncated: false })
  assert.deepEqual(capText('abcd', 2), { text: 'ab', truncated: true })
  assert.deepEqual(capText('abc', 0), { text: '', truncated: true })
  assert.deepEqual(capText(undefined, 5), { text: '', truncated: false })
})

test('buildDigest summarizes the notebook and keeps raw base64 only while it fits', () => {
  const digest = buildDigest(sample.notebook)
  assert.equal(digest.v, 1)
  assert.equal(digest.cellCount, 8)
  assert.equal(digest.cells.length, 8)
  assert.equal(digest.truncated, false)

  const figure = digest.cells.find((cell) => cell.i === 4)
  assert.equal(figure.outputs[0].kind, 'image')
  assert.equal(figure.outputs[0].mime, 'image/png')
  // The fixture carries a real figure, not a 1x1 pixel: the previous speck made an
  // image output look broken and hid the styling bug behind it.
  assert.equal(figure.outputs[0].bytes > 1000, true)
  assert.equal(figure.outputs[0].bytes, base64ByteLength(figure.outputs[0].base64))
  assert.equal(typeof figure.outputs[0].base64, 'string')

  const table = digest.cells.find((cell) => cell.i === 5)
  assert.equal(table.outputs[0].kind, 'html')
  // The fixture carries a faithful pandas `to_html()` table.
  assert.equal(table.outputs[0].text.startsWith('<table'), true)
  assert.equal(table.outputs[0].text.includes('class="dataframe"'), true)

  // Every code cell records a run time, so the gutter always has something to show —
  // the feature was invisible while the fixture carried no timestamps at all.
  const codeCells = sample.notebook.cells.filter((cell) => cell.kind === 'code')
  assert.equal(codeCells.length > 0, true)
  for (const cell of codeCells) {
    assert.equal(typeof cell.durationMs, 'number', `cell ${cell.index} has a duration`)
    assert.equal(cell.durationMs >= 0, true)
  }
  const stamped = digest.cells.filter((cell) => typeof cell.ms === 'number')
  assert.equal(stamped.length, codeCells.length, 'and the digest carries it for the card')

  const failure = digest.cells.find((cell) => cell.i === 6)
  assert.equal(failure.exec, null)
  assert.equal(failure.outputs[0].kind, 'error')

  const json = digest.cells.find((cell) => cell.i === 8)
  assert.equal(json.outputs[0].kind, 'json')
  assert.deepEqual(json.outputs[0].tree, { ok: true, items: [1, 2] })
})

test('buildDigest degrades large images to a placeholder instead of carrying payloads', () => {
  const notebook = {
    nbformat: 4,
    nbformatMinor: 5,
    language: 'python',
    kernel: 'python3',
    cellCount: 1,
    cells: [
      {
        index: 1,
        kind: 'code',
        source: 'plot()',
        executionCount: 1,
        outputs: [{ kind: 'image', mime: 'image/png', base64: 'A'.repeat(4096), bytes: 3072 }]
      }
    ]
  }
  const embedded = buildDigest(notebook)
  assert.equal(embedded.cells[0].outputs[0].kind, 'image')

  const placeholder = buildDigest(notebook, { cardEmbedImageMaxBytes: 16 })
  assert.equal(placeholder.cells[0].outputs[0].kind, 'image-placeholder')
  assert.equal(placeholder.cells[0].outputs[0].bytes, 3072)
})

test('buildDigest caps cell count and character budget', () => {
  const cells = []
  for (let at = 1; at <= 8; at += 1) {
    cells.push({ index: at, kind: 'code', source: 'x'.repeat(100), executionCount: at, outputs: [] })
  }
  const notebook = { nbformat: 4, nbformatMinor: 5, language: 'python', kernel: 'python3', cellCount: 8, cells }

  const byCells = buildDigest(notebook, { cardMaxCells: 3 })
  assert.equal(byCells.cells.length, 3)
  assert.equal(byCells.truncated, true)

  const byChars = buildDigest(notebook, { cardMaxChars: 250, cardCellSourceChars: 1000 })
  assert.equal(byChars.cells.length, 2)
  assert.equal(byChars.truncated, true)

  const bySource = buildDigest(notebook, { cardCellSourceChars: 10 })
  assert.equal(bySource.cells[0].source.length, 10)
  assert.equal(bySource.cells[0].sourceTruncated, true)
  assert.equal(bySource.truncated, true)
})

test('describeDigestOutput never leaks base64', () => {
  const described = describeDigestOutput({ kind: 'image', mime: 'image/png', base64: 'QUJD', bytes: 3 })
  assert.equal(described, '[image output image/png, 3 bytes]')
  assert.equal(described.includes('QUJD'), false)
  assert.match(describeDigestOutput({ kind: 'stream', name: 'stdout', text: 'hi' }), /stdout: hi/)
  assert.match(describeDigestOutput({ kind: 'html', chars: 12, text: '<b>x</b>' }), /html output, 12 chars/)
  assert.match(describeDigestOutput({ kind: 'unsupported', note: 'why' }), /\[why\]/)
})

test('buildToolText renders the notebook and never carries base64', () => {
  const digest = buildDigest(sample.notebook)
  const text = buildToolText(digest)
  assert.match(text, /^<notebook cells="8"/)
  assert.match(text, /cell 1 \(markdown\)/)
  assert.match(text, /cell 2 \(code In\[1\]\)/)
  assert.match(text, /cell 6 \(code In\[ \]\)/)
  assert.match(text, /hello from stdout/)
  assert.match(text, /ValueError: boom/)
  assert.equal(text.includes('iVBORw0KGgo'), false)
  assert.equal(text.includes('"a","b"'), false)
  assert.match(text, /<\/notebook>$/)
})

test('buildToolText respects its character cap', () => {
  const digest = buildDigest(sample.notebook)
  const text = buildToolText(digest, { toolMaxOutputChars: 120 })
  assert.equal(text.length < 300, true)
  assert.match(text, /truncated/)
})

test('parseCellSelector expands numbers, ranges, and out-of-range entries', () => {
  assert.deepEqual(parseCellSelector('1-3,5', 10), [1, 2, 3, 5])
  assert.deepEqual(parseCellSelector('5-3', 10), [3, 4, 5])
  assert.deepEqual(parseCellSelector('2,2,1', 10), [1, 2])
  assert.deepEqual(parseCellSelector('0,11', 10), [])
  assert.deepEqual(parseCellSelector(' 8 , 9 ', 10), [8, 9])
  assert.deepEqual(parseCellSelector(undefined, 10), [])
  assert.deepEqual(parseCellSelector('', 10), [])
  assert.deepEqual(parseCellSelector('nonsense', 10), [])
})

test('selectCells keeps the requested subset and is identity without a selector', () => {
  const filtered = selectCells(sample.notebook, '1,3')
  assert.deepEqual(filtered.cells.map((cell) => cell.index), [1, 3])
  assert.equal(filtered.cellCount, 8)
  assert.equal(selectCells(sample.notebook, undefined), sample.notebook)
})

test('digestSummary reports counts and truncation', () => {
  const digest = buildDigest(sample.notebook)
  const summary = digestSummary(digest)
  assert.match(summary, /8 cells/)
  assert.match(summary, /6 code/)
  assert.match(summary, /5 executed/)
  assert.match(summary, /python/)
  assert.equal(summary.includes('truncated'), false)
  assert.match(digestSummary({ ...digest, truncated: true }), /truncated/)
  // The card's copy is the caller's: user-facing text must not be hard-coded
  // English inside a localized product.
  const localized = digestSummary(digest, { cells: '{n} 个单元格', code: '{n} 段代码', executed: '{n} 个已执行', truncated: '已截断' })
  assert.match(localized, /8 个单元格/)
  assert.match(localized, /6 段代码/)
  assert.match(localized, /5 个已执行/)
  assert.match(digestSummary({ ...digest, truncated: true }, { cells: '{n} c', code: '{n} c', executed: '{n} e', truncated: '已截断' }), /已截断/)
})

test('the shipped limits stay sane', () => {
  assert.equal(LIMITS.cardMaxChars <= LIMITS.toolMaxOutputChars * 4, true)
  assert.equal(LIMITS.cardEmbedImageMaxBytes > 0, true)
})

test('a progress bar collapses to its final frame instead of every frame', () => {
  assert.equal(collapseCarriageReturns('10%\r20%\r30%'), '30%')
  assert.equal(collapseCarriageReturns('a\rb\nc'), 'b\nc')
  // A CRLF line ending is not an overwrite.
  assert.equal(collapseCarriageReturns('a\r\nb\r\n'), 'a\nb\n')
  assert.equal(collapseCarriageReturns('a\r\rb'), 'b')
  assert.equal(collapseCarriageReturns('plain'), 'plain')
  assert.equal(collapseCarriageReturns(undefined), '')
  // Stream normalization applies it, and keeps a raw copy only when there are
  // escapes to color.
  const collapsed = normalizeOutput({ output_type: 'stream', name: 'stdout', text: '1%\r2%\r3%' })
  assert.equal(collapsed.text, '3%')
  assert.equal(collapsed.ansi, undefined)
  const colored = normalizeOutput({ output_type: 'stream', name: 'stderr', text: '\u001b[31mred\u001b[0m' })
  assert.equal(colored.text, 'red', 'the digest and the model stay escape-free')
  assert.equal(colored.ansi, '\u001b[31mred\u001b[0m', 'the renderer gets the raw run')
})

test('ANSI escapes become styled runs instead of being flattened', () => {
  const spans = parseAnsiSpans('\u001b[31mred\u001b[0m plain')
  assert.deepEqual(spans, [
    { text: 'red', style: { color: ANSI_PALETTE[31] } },
    { text: ' plain', style: undefined }
  ])
  // Attributes stack, and 22 clears the one before it.
  assert.deepEqual(parseAnsiSpans('\u001b[1;4mheavy\u001b[0m')[0].style, { fontWeight: 600, textDecoration: 'underline' })
  assert.deepEqual(parseAnsiSpans('\u001b[1mbold\u001b[22mplain'), [
    { text: 'bold', style: { fontWeight: 600 } },
    { text: 'plain', style: undefined }
  ])
  // A background, a bright variant, and a bare `[m` (reset).
  assert.deepEqual(parseAnsiSpans('\u001b[44mblue bg\u001b[0m')[0].style, { background: ANSI_PALETTE[34] })
  assert.equal(parseAnsiSpans('\u001b[91mbright\u001b[0m')[0].style.color, ANSI_PALETTE[31])
  assert.equal(parseAnsiSpans('\u001b[31mred\u001b[m plain')[1].style, undefined)
  // Non-color escapes are dropped, and empty input yields nothing.
  assert.deepEqual(parseAnsiSpans('\u001b[2Kcleared'), [{ text: 'cleared', style: undefined }])
  assert.deepEqual(parseAnsiSpans(''), [])
  assert.deepEqual(parseAnsiSpans(undefined), [])
})
test('a cell reports how long it ran, when the notebook recorded it', () => {
  const execution = {
    'iopub.execute_input': '2026-01-06T09:15:00.000000Z',
    'iopub.status.busy': '2026-01-06T09:15:00.000000Z',
    'shell.execute_reply': '2026-01-06T09:15:01.500000Z'
  }
  assert.equal(executionDuration({ execution }), 1500)
  // The busy stamp is the fallback start: a kernel may never report an input stamp.
  assert.equal(executionDuration({ execution: { 'iopub.status.busy': execution['iopub.status.busy'], 'shell.execute_reply': execution['shell.execute_reply'] } }), 1500)
  // Unknown or impossible values promise nothing.
  assert.equal(executionDuration({ execution: { 'shell.execute_reply': '2026-01-06T09:15:01Z' } }), undefined)
  assert.equal(executionDuration({ execution: { 'iopub.execute_input': 'later', 'shell.execute_reply': 'not a date' } }), undefined)
  assert.equal(
    executionDuration({ execution: { 'iopub.execute_input': '2026-01-06T09:15:02Z', 'shell.execute_reply': '2026-01-06T09:15:01Z' } }),
    undefined,
    'a reply before its input is not a duration'
  )
  assert.equal(executionDuration({}), undefined)
  assert.equal(executionDuration(undefined), undefined)

  // The cell carries it, and the digest carries it as `ms` for the card.
  const cell = normalizeCell({ cell_type: 'code', metadata: { execution }, source: 'x', outputs: [] }, 1)
  assert.equal(cell.durationMs, 1500)
  assert.equal(normalizeCell({ cell_type: 'code', metadata: {}, source: 'x' }, 2).durationMs, undefined)
  const digest = buildDigest(normalizeNotebook({ nbformat: 4, metadata: {}, cells: [{ cell_type: 'code', metadata: { execution }, source: 'x', outputs: [] }] }))
  assert.equal(digest.cells[0].ms, 1500)
})

test('formatDuration reads the way a reader expects', () => {
  assert.equal(formatDuration(0), '0 ms')
  assert.equal(formatDuration(412), '412 ms')
  assert.equal(formatDuration(999), '999 ms')
  assert.equal(formatDuration(1000), '1.0 s')
  assert.equal(formatDuration(1500), '1.5 s')
  assert.equal(formatDuration(59500), '59.5 s')
  assert.equal(formatDuration(60000), '1 m 0 s')
  assert.equal(formatDuration(90500), '1 m 31 s')
  assert.equal(formatDuration(undefined), '')
  assert.equal(formatDuration(-1), '')
  assert.equal(formatDuration(Number.NaN), '')
})

test('highlightRuns marks the matching runs, case-insensitively', () => {
  assert.deepEqual(highlightRuns('Hello World', 'o'), [
    { text: 'Hell', match: false },
    { text: 'o', match: true },
    { text: ' W', match: false },
    { text: 'o', match: true },
    { text: 'rld', match: false }
  ])
  assert.deepEqual(highlightRuns('abc', 'ABC'), [{ text: 'abc', match: true }])
  // Non-overlapping: `aa` in `aaa` marks once, not twice.
  assert.deepEqual(highlightRuns('aaa', 'aa'), [
    { text: 'aa', match: true },
    { text: 'a', match: false }
  ])
  // A blank query is a single unmatched run, so a renderer needs one code path.
  assert.deepEqual(highlightRuns('abc', ''), [{ text: 'abc', match: false }])
  assert.deepEqual(highlightRuns('abc', '  '), [{ text: 'abc', match: false }])
  assert.deepEqual(highlightRuns('abc', 'zz'), [{ text: 'abc', match: false }])
  assert.deepEqual(highlightRuns('', 'a'), [{ text: '', match: false }])
  assert.deepEqual(highlightRuns(undefined, 'a'), [{ text: '', match: false }])
  // The runs always reconstruct the input exactly.
  const text = 'one one one'
  assert.equal(highlightRuns(text, 'one').map((run) => run.text).join(''), text)
})

test('tableToTsv turns the first table into rows a spreadsheet can read', () => {
  const pandas =
    '<table border="1" class="dataframe">\n'
    + '  <thead>\n    <tr style="text-align: right;">\n      <th></th>\n      <th>a</th>\n      <th>b</th>\n    </tr>\n  </thead>\n'
    + '  <tbody>\n    <tr>\n      <th>0</th>\n      <td>1</td>\n      <td>2 &amp; more</td>\n    </tr>\n'
    + '    <tr>\n      <th>1</th>\n      <td><b>3</b></td>\n      <td>4<br>5</td>\n    </tr>\n  </tbody>\n</table>\n'
  assert.equal(tableToTsv(pandas), '\ta\tb\n0\t1\t2 & more\n1\t3\t4 5')
  // No table, no TSV — the control is only offered when there is one.
  assert.equal(tableToTsv('<p>nothing</p>'), '')
  assert.equal(tableToTsv(''), '')
  assert.equal(tableToTsv(undefined), '')
  // Only the first table is converted, and a nested table does not end the outer one.
  const two = '<table><tr><td>first</td></tr></table><table><tr><td>second</td></tr></table>'
  assert.equal(tableToTsv(two), 'first')
  const nested = '<table><tr><td>x<table><tr><td>in</td></tr></table>y</td></tr></table>'
  // A nested table cannot be represented in rows, so its content is dropped rather
  // than allowed to end an outer row.
  assert.equal(tableToTsv(nested), 'xy')
  // A ragged row keeps its own cell count.
  assert.equal(tableToTsv('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>'), 'a\tb\nc')
})

test('findCells searches source and output text, case-insensitively', () => {
  const cells = normalizeNotebook({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      { cell_type: 'markdown', metadata: {}, source: '# Title\n' },
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'x = 1\n',
        outputs: [
          { output_type: 'stream', name: 'stdout', text: '\u001b[31mHello World\u001b[0m\n' },
          { output_type: 'display_data', metadata: {}, data: { 'image/png': 'QUJD' } }
        ]
      },
      { cell_type: 'code', execution_count: 2, metadata: {}, source: 'nothing here\n', outputs: [] }
    ]
  }).cells

  assert.deepEqual(findCells(cells, 'hello'), [2], 'case-insensitive, and output text counts')
  assert.deepEqual(findCells(cells, 'TITLE'), [1])
  assert.deepEqual(findCells(cells, 'nothing'), [3])
  assert.deepEqual(findCells(cells, 'image/png'), [2], 'an output MIME is findable')
  assert.deepEqual(findCells(cells, 'missing'), [])
  // A blank query matches nothing rather than everything.
  assert.deepEqual(findCells(cells, ''), [])
  assert.deepEqual(findCells(cells, '   '), [])
  assert.deepEqual(findCells(cells, undefined), [])
  // What is searched is the visible text: no escape sequences.
  assert.equal(cellSearchText(cells[1]).includes('\u001B'), false)
  assert.match(cellSearchText(cells[1]), /Hello World/)
})

test('notebookOutline nests cells under the heading before them', () => {
  const cells = normalizeNotebook({
    nbformat: 4,
    metadata: {},
    cells: [
      { cell_type: 'markdown', metadata: {}, source: '# One\n\nprose\n' },
      { cell_type: 'code', execution_count: 4, metadata: {}, source: '\n\n  run()\n', outputs: [] },
      { cell_type: 'markdown', metadata: {}, source: '### Three\n' },
      { cell_type: 'raw', metadata: {}, source: 'raw text\n' }
    ]
  }).cells
  // A cell's level is the level of the heading it follows, plus one: that is what
  // makes a notebook with many code cells read as sections instead of a flat list.
  assert.deepEqual(notebookOutline(cells), [
    { index: 1, kind: 'heading', level: 1, label: 'One' },
    { index: 2, kind: 'code', level: 2, label: 'In [4] run()' },
    { index: 3, kind: 'heading', level: 3, label: 'Three' },
    { index: 4, kind: 'raw', level: 4, label: 'raw raw text' }
  ])
  // Headings only, which is what the rail shows by default.
  assert.deepEqual(
    notebookOutline(cells, { includeCode: false }).map((entry) => entry.label),
    ['One', 'Three']
  )
  // A cell before any heading sits at the top level.
  const leading = normalizeNotebook({
    nbformat: 4,
    metadata: {},
    cells: [
      { cell_type: 'code', execution_count: 1, metadata: {}, source: 'setup()\n', outputs: [] },
      { cell_type: 'markdown', metadata: {}, source: '# After\n' }
    ]
  }).cells
  assert.deepEqual(notebookOutline(leading), [
    { index: 1, kind: 'code', level: 0, label: 'In [1] setup()' },
    { index: 2, kind: 'heading', level: 1, label: 'After' }
  ])

  // With no heading anywhere the cells are the only navigation there is, so they stay
  // even when code is not asked for.
  const prose = normalizeNotebook({
    nbformat: 4,
    metadata: {},
    cells: [
      { cell_type: 'markdown', metadata: {}, source: 'Just prose.\n' },
      { cell_type: 'markdown', metadata: {}, source: '\n\n#\n\nMore prose.\n' },
      { cell_type: 'code', execution_count: 2, metadata: {}, source: 'work()\n', outputs: [] }
    ]
  }).cells
  assert.deepEqual(notebookOutline(prose, { includeCode: false }).map((entry) => entry.label), [
    'Just prose.',
    'More prose.',
    'In [2] work()'
  ])
  assert.deepEqual(notebookOutline([]), [])
  assert.deepEqual(notebookOutline(undefined), [])
  // An empty code cell still gets an entry, labelled by its prompt alone.
  const empty = normalizeNotebook({ nbformat: 4, metadata: {}, cells: [{ cell_type: 'code', metadata: {}, source: '', outputs: [] }] }).cells
  assert.deepEqual(notebookOutline(empty), [{ index: 1, kind: 'code', level: 0, label: 'In [ ]' }])
})

test('relativeImageDestinations finds what a notebook names relatively', () => {
  const cells = normalizeNotebook({
    nbformat: 4,
    metadata: {},
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: [
          '![a](figs/a.png)\n',
          '![b](<figs/with space.png>)\n',
          '![c](figs/a.png "a title")\n',
          '![remote](https://example.com/x.png)\n',
          '![data](data:image/png;base64,QUJD)\n',
          '![abs](/work/figs/c.png)\n',
          '[link](figs/not-an-image.png)\n'
        ]
      },
      { cell_type: 'markdown', metadata: {}, source: '![attached](attachment:x.png)' },
      { cell_type: 'code', metadata: {}, source: '![in code](figs/d.png)', outputs: [] }
    ]
  }).cells

  // A remote URL, a data URL, an absolute path, an anchor and a plain link are all
  // outside this: only what the file resolver can join to the notebook's directory.
  assert.deepEqual(relativeImageDestinations(cells), ['figs/a.png', 'figs/with space.png'])
  assert.deepEqual(relativeImageDestinations([]), [])
  assert.deepEqual(relativeImageDestinations(undefined), [])
})

test('the raw view shows the file as saved, and says when it capped', () => {
  const source = '{\n "cells": []\n}\n'
  assert.deepEqual(rawViewText(source), { text: source, truncated: false })
  // Not re-serialized: the file's own whitespace is what a reader sees.
  assert.equal(rawViewText(source).text.includes('\n "cells"'), true)
  const capped = rawViewText('x'.repeat(50), 10)
  assert.equal(capped.truncated, true)
  assert.equal(capped.text.startsWith('x'.repeat(10)), true)
  assert.match(capped.text, /truncated/)
  assert.deepEqual(rawViewText(undefined), { text: '', truncated: false })
  // The default cap is the documented limit.
  assert.equal(rawViewText('y'.repeat(LIMITS.previewRawChars + 1)).truncated, true)
})

test('cell tags are carried on every cell kind, and capped', () => {
  // Tags record what a cell is for (papermill, nbval, nbconvert), so they must
  // survive normalization on markdown cells too — not only on code cells.
  const code = normalizeCell({ cell_type: 'code', metadata: { tags: ['parameters', 'parameters', ' papermill ', 42, ''] }, source: 'x' }, 1)
  assert.deepEqual(code.tags, ['parameters', 'papermill'])
  const markdown = normalizeCell({ cell_type: 'markdown', metadata: { tags: ['remove_cell'] }, source: '# h' }, 2)
  assert.deepEqual(markdown.tags, ['remove_cell'])
  assert.equal(normalizeCell({ cell_type: 'code', metadata: {}, source: 'y' }, 3).tags, undefined)
  assert.equal(normalizeCell({ cell_type: 'code', metadata: { tags: 'parameters' }, source: 'y' }, 4).tags, undefined)
  const many = normalizeCell({ cell_type: 'code', metadata: { tags: Array.from({ length: 40 }, (_, i) => `t${i}`) }, source: 'z' }, 5)
  assert.equal(many.tags.length, LIMITS.previewMaxTags)
})

test('Jupyter hidden flags are read from the jupyter namespace only', () => {
  const both = normalizeCell(
    { cell_type: 'code', metadata: { jupyter: { source_hidden: true, outputs_hidden: true } }, source: 'x' },
    1
  )
  assert.equal(both.sourceHidden, true)
  assert.equal(both.outputsHidden, true)
  // A top-level flag of the same name is not what Jupyter writes.
  const wrong = normalizeCell({ cell_type: 'code', metadata: { source_hidden: true }, source: 'x' }, 2)
  assert.equal(wrong.sourceHidden, false)
  assert.equal(normalizeCell({ cell_type: 'code', metadata: { jupyter: { source_hidden: 'yes' } }, source: 'x' }, 3).sourceHidden, false)
})

test('a code cell carries the collapsed flag its notebook saved', () => {
  // Jupyter writes `metadata.collapsed` when a user collapses an output, so a
  // reopened notebook should not flood the page with that output.
  const notebook = normalizeNotebook({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      { cell_type: 'code', metadata: { collapsed: true }, source: 'x', outputs: [] },
      { cell_type: 'code', metadata: { scrolled: true }, source: 'y', outputs: [] },
      { cell_type: 'code', metadata: { collapsed: 'yes' }, source: 'z', outputs: [] },
      { cell_type: 'code', metadata: {}, source: 'w', outputs: [] },
      { cell_type: 'code', source: 'no metadata', outputs: [] }
    ]
  })
  assert.equal(notebook.cells[0].collapsed, true)
  assert.equal(notebook.cells[1].collapsed, false, 'scrolled is a different flag')
  assert.equal(notebook.cells[2].collapsed, false, 'only a boolean true counts')
  assert.equal(notebook.cells[3].collapsed, false)
  assert.equal(notebook.cells[4].collapsed, false)
})

test('a markdown cell keeps its attachments out of the digest', () => {
  const notebook = normalizeNotebook({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      { cell_type: 'markdown', metadata: {}, source: '![x](attachment:a.png)', attachments: { 'a.png': { 'image/png': 'QUJD' } } },
      { cell_type: 'markdown', metadata: {}, source: 'plain' },
      { cell_type: 'markdown', metadata: {}, source: 'empty', attachments: {} }
    ]
  })
  assert.deepEqual(notebook.cells[0].attachments, { 'a.png': { 'image/png': 'QUJD' } })
  assert.equal(notebook.cells[1].attachments, undefined)
  assert.equal(notebook.cells[2].attachments, undefined)
  // The digest is a bounded summary: an embedded payload stays out of it.
  assert.equal(JSON.stringify(buildDigest(notebook)).includes('QUJD'), false)
})

test('an attachment reference resolves from the cell itself', () => {
  const attachments = { 'a.png': { 'image/png': 'QUJD' }, 'v.svg': { 'image/svg+xml': '<svg/>' } }
  assert.equal(attachmentDataUrl(attachments, 'attachment:a.png'), 'data:image/png;base64,QUJD')
  assert.equal(attachmentDataUrl(attachments, 'Attachment:a.png'), 'data:image/png;base64,QUJD')
  assert.equal(attachmentDataUrl(attachments, 'attachment:v.svg'), 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  assert.equal(attachmentDataUrl(attachments, 'attachment:missing.png'), undefined)
  assert.equal(attachmentDataUrl(attachments, 'figs/a.png'), undefined, 'a relative path is the file resolver’s business')
  assert.equal(attachmentDataUrl(undefined, 'attachment:a.png'), undefined)
  // An encoded name is decoded once, and the literal name still matches.
  assert.equal(attachmentDataUrl({ 'a b.png': { 'image/png': 'QUJD' } }, 'attachment:a%20b.png'), 'data:image/png;base64,QUJD')
  assert.equal(attachmentDataUrl({ 'a b.png': { 'image/png': 'QUJD' } }, 'attachment:a b.png'), 'data:image/png;base64,QUJD')
})

test('an image payload becomes the right data URL', () => {
  assert.equal(imageDataUrl('image/png', 'QUJD'), 'data:image/png;base64,QUJD')
  assert.equal(imageDataUrl('image/png', 'QU\nJD'), 'data:image/png;base64,QUJD')
  assert.equal(imageDataUrl('image/svg+xml', '<svg/>'), 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  assert.equal(imageDataUrl('image/png', ''), undefined)
  assert.equal(imageDataUrl('image/png', undefined), undefined)
})

test('the path helpers follow this deployment’s lexical rules', () => {
  assert.equal(isAbsoluteWorkspacePath('/etc/hosts'), true)
  assert.equal(isAbsoluteWorkspacePath('C:\\nb\\a.png'), true)
  assert.equal(isAbsoluteWorkspacePath('\\\\server\\share\\a.png'), true)
  assert.equal(isAbsoluteWorkspacePath('figs/a.png'), false)
  assert.equal(isAbsoluteWorkspacePath('./a.png'), false)

  assert.deepEqual(pathPartsOf('/a/b/c.ipynb'), { directory: '/a/b/', name: 'c.ipynb' })
  assert.deepEqual(pathPartsOf('C:\\a\\b.ipynb'), { directory: 'C:\\a\\', name: 'b.ipynb' })
  assert.deepEqual(pathPartsOf('/a/b/'), { directory: '/a/', name: 'b' })
  assert.deepEqual(pathPartsOf('/'), { directory: '', name: '/' })
})

test('the zoom affordance appears only when fitting actually shrinks the image', () => {
  // A figure smaller than the pane renders at its intrinsic size either way, so
  // offering "view actual size" there is a control that cannot do anything — which
  // is what made it look broken.
  assert.equal(imageIsConstrained(480, 280, 1200, 1000), false)
  assert.equal(imageIsConstrained(1800, 1000, 1200, 1000), true, 'wider than the pane')
  assert.equal(imageIsConstrained(1200, 600, 1200, 1000), false, 'exactly the pane width is not constrained')
  assert.equal(imageIsConstrained(400, 900, 1200, 1000), true, 'taller than 70% of the viewport')
  assert.equal(imageIsConstrained(400, 700, 1200, 1000), false, 'exactly at the height cap is not constrained')
  assert.equal(imageIsConstrained(400, 900, 1200, 1000, 0.9), false, 'the cap is a parameter')
  // Unknown geometry must not promise a control.
  for (const bad of [[0, 100, 100, 100], [100, 100, 0, 100], [100, 100, 100, 0], [NaN, 1, 1, 1], [undefined, 1, 1, 1]]) {
    assert.equal(imageIsConstrained(...bad), false, `expected no constraint for ${JSON.stringify(bad)}`)
  }
})

test('a relative markdown image joins the notebook directory and the file route', () => {
  const base = 'http://127.0.0.1:19999/'
  const media = (path) => `${base}api/file?path=${encodeURIComponent(path)}`
  const document = '/work/nb/figures/demo.ipynb'

  assert.equal(markdownImageUrl(base, document, 'a.png'), media('/work/nb/figures/a.png'))
  assert.equal(markdownImageUrl(base, document, './a.png'), media('/work/nb/figures/./a.png'))
  assert.equal(markdownImageUrl(base, document, 'sub/a.png'), media('/work/nb/figures/sub/a.png'))
  assert.equal(markdownImageUrl(base, document, '/abs/b.png'), media('/abs/b.png'))
  // A query or fragment never reaches the file route, and the URL decodes once.
  assert.equal(markdownImageUrl(base, document, 'a.png?v=1#frag'), media('/work/nb/figures/a.png'))
  assert.equal(markdownImageUrl(base, document, 'a%20b.png'), media('/work/nb/figures/a b.png'))
  // A Windows drive path is absolute, not a scheme.
  assert.equal(markdownImageUrl(base, 'C:/nb/demo.ipynb', 'C:\\nb\\a.png'), media('C:\\nb\\a.png'))

  // Left to the renderer, or genuinely unaddressable.
  assert.equal(markdownImageUrl(base, document, 'https://example.com/a.png'), undefined)
  assert.equal(markdownImageUrl(base, document, 'data:image/png;base64,AAAA'), undefined)
  assert.equal(markdownImageUrl(base, document, ''), undefined)
  assert.equal(markdownImageUrl(base, document, '%ZZ'), undefined)
  assert.equal(markdownImageUrl(base, undefined, 'a.png'), undefined, 'no absolute path, no vocabulary')

  // The desktop scheme is addressed the same way; other transports are not.
  assert.equal(markdownImageUrl('dsh-app://app/', document, 'a.png').startsWith('dsh-app://app/api/file?path='), true)
  assert.equal(markdownImageUrl('file:///tmp/', document, 'a.png'), undefined)
  assert.equal(fileMediaUrl(base, 'relative.png'), undefined)
  assert.equal(fileMediaUrl(base, '//server/share/a.png'), undefined, 'a UNC path is outside the file route')
  // A base this deployment reports but `URL` cannot parse is not addressable, and must
  // not throw: the resolver runs during a render.
  assert.equal(fileMediaUrl('http:', '/a/b.png'), undefined)
  assert.equal(fileMediaUrl('not a url', '/a/b.png'), undefined)
  // A scheme is case-insensitive, and `URL` normalizes it.
  assert.equal(fileMediaUrl('HTTP://host/', '/a/b.png'), `http://host/api/file?path=${encodeURIComponent('/a/b.png')}`)
})
