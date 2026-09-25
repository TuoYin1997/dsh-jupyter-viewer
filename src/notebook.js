/**
 * nbformat 4 reading and projection, shared by the Node half (the
 * `read_notebook` tool) and the browser half (the document preview and the tool
 * card).
 *
 * Plain ES module with no imports on purpose: `scripts/build-client.mjs`
 * inlines this file into the served browser bundle, so every export must stay
 * at the start of its own line as `export function` or `export const`.
 *
 * Nothing here touches the filesystem, the DOM, or React. It turns notebook
 * text into a normal form, projects that normal form into a size-bounded
 * "digest" for the tool card, and projects the digest into the compact text the
 * model reads. Raw base64 payloads never reach the model: the digest either
 * embeds an image small enough to ride the session log or records its byte
 * size.
 */

/** Every limit the host digest and the browser preview apply. */
export const LIMITS = {
  /** Digests keep at most this many cells. */
  cardMaxCells: 200,
  /** Digests keep at most this many characters of source plus output. */
  cardMaxChars: 32768,
  /** Images up to this size ride the digest as a data URL; larger ones keep their size only. */
  cardEmbedImageMaxBytes: 65536,
  /** One cell's source is capped at this many characters inside a digest. */
  cardCellSourceChars: 4000,
  /** One output block is capped at this many characters inside a digest. */
  cardOutputChars: 8192,
  /** The preview renders at most this many cells up front. */
  previewMaxCells: 300,
  /** An HTML output above this size renders as text instead of a sandboxed document. */
  previewMaxHtmlChars: 524288,
  /** One output block is capped at this many characters in the preview. */
  previewOutputChars: 20000,
  /** A cell shows at most this many tags. */
  previewMaxTags: 12,
  /** The raw-JSON view renders at most this many characters. */
  previewRawChars: 200000,
  /** The whole model-facing projection is capped at this many characters. */
  toolMaxOutputChars: 20000,
  /** One cell's source in the model-facing projection. */
  toolCellSourceChars: 2000,
  /** One stream or text output in the model-facing projection. */
  toolOutputChars: 1000
}

/**
 * MIME types a `display_data` / `execute_result` payload is ranked by; the
 * first present key wins. HTML comes first so a pandas table renders as a
 * table, then images, then text forms.
 */
export const RICH_MIME_PRIORITY = [
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/markdown',
  'application/json',
  'text/plain',
  'text/latex'
]

const ANSI_OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
const ANSI_CSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OTHER = /\u001B[@-Z\\-_]/g

/**
 * Remove ANSI escape sequences from captured output.
 * @param text - raw output text.
 * @returns the text without escapes; a non-string input becomes `''`.
 */
export function stripAnsi(text) {
  if (typeof text !== 'string') return ''
  if (text.indexOf('\u001B') === -1) return text
  return text.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(ANSI_OTHER, '')
}

/**
 * Collapse carriage-return overwrites.
 *
 * A terminal moves the cursor to the start of the line on `\r`, so only the last
 * segment of each line was ever visible. A progress bar (tqdm and friends) emits
 * one line per frame, and rendering every frame mashed them into one illegible
 * line — Jupyter collapses them the same way this does.
 * @param text - captured output.
 * @returns the text with each line reduced to its final `\r` segment.
 */
export function collapseCarriageReturns(text) {
  if (typeof text !== 'string') return ''
  if (text.indexOf('\r') === -1) return text
  return text
    .split('\n')
    .map((line) => {
      // A trailing `\r` is a CRLF line ending, not an overwrite.
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
      const cut = trimmed.lastIndexOf('\r')
      return cut === -1 ? trimmed : trimmed.slice(cut + 1)
    })
    .join('\n')
}

/**
 * The terminal palette for SGR colors 30-37 and 90-97.
 *
 * A terminal's colors are a fixed standard, not theme tokens, so these are
 * literals on purpose. Black and white map to `currentColor` so the two ends of
 * the palette follow the theme instead of fighting it; the rest are mid-tone
 * enough to read on either a light or a dark surface.
 */
export const ANSI_PALETTE = {
  30: 'currentColor',
  31: '#c0392b',
  32: '#1e8449',
  33: '#9a7d0a',
  34: '#2471c4',
  35: '#8e44ad',
  36: '#0e7490',
  37: 'currentColor'
}

/** Apply one SGR code to a style object. */
function applySgr(style, code) {
  const next = { ...style }
  if (code === 0) return {}
  if (code === 1) next.fontWeight = 600
  else if (code === 2) next.opacity = 0.7
  else if (code === 3) next.fontStyle = 'italic'
  else if (code === 4) next.textDecoration = 'underline'
  else if (code === 22) delete next.fontWeight
  else if (code === 23) delete next.fontStyle
  else if (code === 24) delete next.textDecoration
  else if (code === 39) delete next.color
  else if (code === 49) delete next.background
  else if (code >= 30 && code <= 37) next.color = ANSI_PALETTE[code]
  else if (code >= 90 && code <= 97) {
    next.color = code - 60 >= 30 && code - 60 <= 37 ? ANSI_PALETTE[code - 60] : undefined
    if (next.color === undefined) delete next.color
  }
  else if (code >= 40 && code <= 47) next.background = ANSI_PALETTE[code - 10]
  return next
}

const SGR_PATTERN = /\u001B\[([0-9;]*)m/g

/**
 * Split text into runs carrying the styles its SGR sequences select, dropping
 * every other escape sequence. Used by the preview and the card so captured
 * output keeps its colors instead of being flattened to plain text.
 * @param text - captured output, possibly with ANSI escapes.
 * @returns runs in source order; a run's `style` is undefined when it carries none.
 */
export function parseAnsiSpans(text) {
  const value = typeof text === 'string' ? text : ''
  if (value.length === 0) return []
  const spans = []
  let style = {}
  let buffer = ''
  const flush = () => {
    if (buffer.length === 0) return
    spans.push({ text: buffer, style: Object.keys(style).length > 0 ? { ...style } : undefined })
    buffer = ''
  }
  let cursor = 0
  for (const match of value.matchAll(SGR_PATTERN)) {
    buffer += value.slice(cursor, match.index)
    // Flush before applying the codes: the text already buffered belongs to the
    // style that was in effect, not to the one this sequence selects.
    flush()
    const codes = match[1] === '' ? [0] : match[1].split(';').map((part) => Number(part) || 0)
    for (const code of codes) style = applySgr(style, code)
    cursor = match.index + match[0].length
  }
  buffer += value.slice(cursor)
  flush()
  // Any non-SGR escape that survived is stripped from the runs.
  return spans.map((span) => (span.text.indexOf('\u001B') === -1 ? span : { ...span, text: stripAnsi(span.text) }))
}

/**
 * Read an nbformat `source` / `text` value, which is a string or an array of
 * line fragments.
 * @param value - the raw value.
 * @returns the joined text; a missing value becomes `''`.
 */
export function joinSource(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    let out = ''
    for (const part of value) if (typeof part === 'string') out += part
    return out
  }
  return ''
}

/**
 * Byte size of a base64 payload, ignoring whitespace and padding.
 * @param base64 - the encoded payload.
 * @returns the decoded byte count.
 */
export function base64ByteLength(base64) {
  const trimmed = String(base64).replace(/\s+/g, '')
  if (trimmed.length === 0) return 0
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

/**
 * True for every MIME type the preview renders as a picture.
 * @param mime - a MIME type.
 * @returns whether the type is an image.
 */
export function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}

/**
 * Pick the payload a `display_data` / `execute_result` output should render.
 * @param data - the output's MIME bundle.
 * @returns the selected MIME type, the first present key when nothing is ranked,
 * or `undefined` for an empty or malformed bundle.
 */
export function selectDataMime(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  for (const mime of RICH_MIME_PRIORITY) {
    if (Object.prototype.hasOwnProperty.call(data, mime)) return mime
  }
  const keys = Object.keys(data)
  return keys.length > 0 ? keys[0] : undefined
}

/**
 * Parse one raw MIME-bundle value into a JSON-tree payload.
 * @param value - the raw payload.
 * @returns an object or array JsonTree accepts.
 */
export function toJsonTreeValue(value) {
  if (value === null) return { value: null }
  if (Array.isArray(value) || typeof value === 'object') return value
  return { value }
}

/**
 * Normalize one cell's output into the shape both projections consume.
 * @param output - one entry of `cell.outputs`.
 * @returns the normal form.
 */
export function normalizeOutput(output) {
  if (output === null || typeof output !== 'object') {
    return { kind: 'unsupported', note: 'malformed output entry' }
  }
  const type = output.output_type
  if (type === 'stream') {
    // `text` stays escape-free for the digest and the model; `ansi` keeps the one
    // raw copy the renderer needs to color the preview, and only when there is
    // something to color.
    const raw = collapseCarriageReturns(joinSource(output.text))
    const hasAnsi = raw.indexOf('\u001B') !== -1
    return {
      kind: 'stream',
      name: output.name === 'stderr' ? 'stderr' : 'stdout',
      text: stripAnsi(raw),
      ...(hasAnsi ? { ansi: raw } : {})
    }
  }
  if (type === 'error') {
    // A traceback is colored too, so the raw copy is kept the same way a stream's is.
    const traceback = collapseCarriageReturns(Array.isArray(output.traceback) ? output.traceback.join('\n') : '')
    const hasAnsi = traceback.indexOf('\u001B') !== -1
    return {
      kind: 'error',
      name: typeof output.ename === 'string' ? output.ename : 'Error',
      value: typeof output.evalue === 'string' ? output.evalue : '',
      text: stripAnsi(traceback),
      ...(hasAnsi ? { ansi: traceback } : {})
    }
  }
  if (type === 'execute_result' || type === 'display_data') {
    const data = output.data !== null && typeof output.data === 'object' ? output.data : {}
    const mime = selectDataMime(data)
    if (mime === undefined) return { kind: 'unsupported', note: 'output carries no data' }
    if (isImageMime(mime)) {
      const payload = joinSource(data[mime])
      if (mime === 'image/svg+xml') {
        return { kind: 'image', mime, svg: payload, bytes: payload.length }
      }
      const base64 = payload.replace(/\s+/g, '')
      return { kind: 'image', mime, base64, bytes: base64ByteLength(base64) }
    }
    if (mime === 'application/json') {
      return { kind: 'json', mime, tree: toJsonTreeValue(data[mime]), text: JSON.stringify(data[mime]) }
    }
    const text = joinSource(data[mime])
    if (mime === 'text/html') return { kind: 'html', mime, text }
    return { kind: 'text', mime, text }
  }
  return { kind: 'unsupported', note: `unsupported output_type ${String(type)}` }
}

/**
 * Normalize one cell into the shape both projections consume.
 * @param cell - one entry of the notebook's `cells`.
 * @param index - the cell's 1-based position.
 * @returns the normal form.
 */
export function normalizeCell(cell, index) {
  const raw = cell !== null && typeof cell === 'object' ? cell : {}
  const type = raw.cell_type
  const kind = type === 'code' ? 'code' : type === 'markdown' ? 'markdown' : 'raw'
  const source = joinSource(raw.source)
  const tags = normalizeTags(raw.metadata)
  if (kind !== 'code') {
    // Attachments are only carried when present, and they never enter a digest:
    // they are image payloads, and the digest is a bounded summary. `source_hidden`
    // applies to any cell kind — Jupyter honours it on markdown too, where it hides
    // the rendered prose.
    const attachments = normalizeAttachments(raw.attachments)
    return {
      index,
      kind,
      source,
      sourceHidden: jupyterFlag(raw.metadata, 'source_hidden'),
      ...(attachments === undefined ? {} : { attachments }),
      ...(tags === undefined ? {} : { tags })
    }
  }
  return {
    index,
    kind,
    source,
    executionCount: typeof raw.execution_count === 'number' ? raw.execution_count : null,
    // How long the run took, when the notebook recorded it.
    ...(executionDuration(raw.metadata) === undefined ? {} : { durationMs: executionDuration(raw.metadata) }),
    // A notebook that saved its long outputs collapsed should open that way: Jupyter
    // writes this when a user collapses an output so it does not flood the page.
    collapsed: metadataFlag(raw.metadata, 'collapsed'),
    // `scrolled` means the output area is height-limited in Jupyter; the preview
    // caps it the same way rather than expanding the whole output.
    scrolled: metadataFlag(raw.metadata, 'scrolled'),
    // Jupyter's own hiding semantics, written by its UI and read by nbconvert.
    sourceHidden: jupyterFlag(raw.metadata, 'source_hidden'),
    outputsHidden: jupyterFlag(raw.metadata, 'outputs_hidden'),
    ...(tags === undefined ? {} : { tags }),
    outputs: Array.isArray(raw.outputs) ? raw.outputs.map(normalizeOutput) : []
  }
}

/** Read a boolean cell-metadata flag without trusting the shape. */
function metadataFlag(metadata, name) {
  if (metadata === null || typeof metadata !== 'object') return false
  return metadata[name] === true
}

/** Read a boolean flag from the cell's `jupyter` metadata namespace. */
function jupyterFlag(metadata, name) {
  if (metadata === null || typeof metadata !== 'object') return false
  const jupyter = metadata.jupyter
  if (jupyter === null || typeof jupyter !== 'object') return false
  return jupyter[name] === true
}

/**
 * Read a cell's `metadata.tags`.
 *
 * Tags are how a toolchain records what a cell is for — papermill's `parameters`,
 * nbval's `raises-exception`, nbconvert's `remove_cell` — so dropping them hides
 * information the notebook carries on purpose.
 * @param metadata - the cell's metadata.
 * @returns the tags, or undefined when the cell has none.
 */
export function normalizeTags(metadata) {
  if (metadata === null || typeof metadata !== 'object') return undefined
  const raw = metadata.tags
  if (!Array.isArray(raw)) return undefined
  const tags = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const tag = value.trim()
    if (tag.length === 0 || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length === LIMITS.previewMaxTags) break
  }
  return tags.length > 0 ? tags : undefined
}

/**
 * Normalize a cell's `attachments` map into `{ name: { mime: payload } }`.
 * @param raw - the cell's `attachments` value.
 * @returns the map, or undefined when the cell carries none.
 */
export function normalizeAttachments(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const names = Object.keys(raw)
  if (names.length === 0) return undefined
  const attachments = {}
  for (const name of names) {
    const bundle = raw[name]
    if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) continue
    const mimes = {}
    for (const mime of Object.keys(bundle)) {
      const payload = bundle[mime]
      if (typeof payload === 'string' && payload.length > 0) mimes[mime] = payload
    }
    if (Object.keys(mimes).length > 0) attachments[name] = mimes
  }
  return Object.keys(attachments).length > 0 ? attachments : undefined
}

/** The named character references worth decoding in a table cell. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/**
 * Decode the character references a table cell is likely to contain.
 * @param text - cell markup.
 * @returns the decoded text.
 */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const key = name.toLowerCase()
    if (key in ENTITIES) return ENTITIES[key]
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16) || 0)
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10) || 0)
    return whole
  })
}

/** The text of one table cell: tags removed, entities decoded, whitespace collapsed. */
function cellText(markup) {
  return decodeEntities(
    String(markup)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The first table in an HTML output as tab-separated rows.
 *
 * A rendered DataFrame is the one output a reader most often wants elsewhere —
 * a spreadsheet, a diff, a chat message — and hand-selecting it out of a frame is
 * tedious. Only the first table is converted, `colspan`/`rowspan` are not
 * expanded, and a cell's internal line breaks become spaces, because TSV has no
 * way to carry them.
 * @param html - the output's markup.
 * @returns the TSV text, or an empty string when there is no table.
 */
export function tableToTsv(html) {
  const source = typeof html === 'string' ? html : ''
  const open = /<table[\s>]/i.exec(source)
  if (open === null) return ''
  // Find the matching close tag, so a nested table does not end the outer one.
  const tag = /<(\/?)table[\s>]/gi
  tag.lastIndex = open.index
  let depth = 0
  let end = -1
  for (let match = tag.exec(source); match !== null; match = tag.exec(source)) {
    depth += match[1] === '/' ? -1 : 1
    if (depth === 0) {
      end = match.index
      break
    }
  }
  const inner = source.slice(source.indexOf('>', open.index) + 1, end === -1 ? source.length : end)
  // A nested table cannot be represented in rows, and leaving it in place would make
  // its `</tr>` end an outer row. Its content is therefore dropped.
  let flat = inner
  while (/<table[\s>]/i.test(flat)) flat = flat.replace(/<table[\s>][\s\S]*?<\/table\s*>/i, '')
  const rows = []
  for (const row of flat.match(/<tr[\s>][\s\S]*?<\/tr\s*>|<tr>[\s\S]*?<\/tr\s*>/gi) ?? []) {
    const cells = []
    for (const cell of row.match(/<t[dh][\s>][\s\S]*?<\/t[dh]>|<t[dh]>[\s\S]*?<\/t[dh]>/gi) ?? []) {
      cells.push(cellText(cell.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '')))
    }
    if (cells.length > 0) rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}

/**
 * Split text into runs the query matches, for highlighting.
 *
 * Case-insensitive and non-overlapping, so `aa` in `aaa` marks one occurrence
 * rather than overlapping ones. A blank query yields a single unmatched run, which
 * lets a renderer use one path either way.
 * @param text - the visible text.
 * @param query - the search text.
 * @returns runs in order, each flagged with whether it is a match.
 */
export function highlightRuns(text, query) {
  const value = typeof text === 'string' ? text : ''
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle.length === 0 || value.length === 0) return [{ text: value, match: false }]
  const runs = []
  const haystack = value.toLowerCase()
  let cursor = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    if (at > cursor) runs.push({ text: value.slice(cursor, at), match: false })
    runs.push({ text: value.slice(at, at + needle.length), match: true })
    cursor = at + needle.length
  }
  if (cursor < value.length) runs.push({ text: value.slice(cursor), match: false })
  return runs
}

/**
 * How long a cell took to run, from the timestamps Jupyter records.
 *
 * A notebook stores these as `metadata.execution` with ISO-8601 values for
 * `iopub.execute_input`, `iopub.status.busy` and `shell.execute_reply`. The input
 * and reply stamps bound the run; the busy stamp is the fallback start, because a
 * kernel that never reported an input stamp still reported busy.
 * @param metadata - the cell's metadata.
 * @returns the duration in milliseconds, or undefined when it cannot be known.
 */
export function executionDuration(metadata) {
  if (metadata === null || typeof metadata !== 'object') return undefined
  const execution = metadata.execution
  if (execution === null || typeof execution !== 'object') return undefined
  const end = Date.parse(String(execution['shell.execute_reply'] ?? ''))
  const start = Date.parse(String(execution['iopub.execute_input'] ?? execution['iopub.status.busy'] ?? ''))
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  const ms = end - start
  return ms >= 0 ? ms : undefined
}

/**
 * Format a duration the way a notebook reader expects: seconds with one decimal,
 * minutes for anything longer, and milliseconds when it is under a second.
 * @param ms - the duration in milliseconds.
 * @returns the formatted text.
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes} m ${rest} s`
}

/**
 * The relative image destinations a notebook's markdown asks for.
 *
 * Used to say *why* a figure is not showing: without the document's absolute path a
 * relative destination cannot be addressed, and an image that silently never appears
 * reads as a broken plugin.
 * @param cells - normalized cells.
 * @returns the distinct relative destinations, in document order.
 */
export function relativeImageDestinations(cells) {
  const found = []
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (cell === null || cell.kind !== 'markdown' || typeof cell.source !== 'string') continue
    // The markdown image syntax: a destination in angle brackets may contain spaces,
    // a bare one may not, and either may be followed by a quoted title.
    for (const match of cell.source.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
      const destination = match[1] ?? match[2]
      if (isAbsoluteWorkspacePath(destination)) continue
      if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('#')) continue
      if (!found.includes(destination)) found.push(destination)
    }
  }
  return found
}

/** An ATX heading: up to three leading spaces, one to six `#`, then the text. */
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/

/** The first line of a source worth using as a label. */
function firstMeaningfulLine(lines) {
  return lines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^#+$/.test(line))
}

/**
 * The notebook as a navigable list.
 *
 * Headings are the spine: a cell belongs **under** the heading that precedes it, one
 * level deeper (`level` = that heading's level + 1), so a notebook with twenty code
 * cells and three headings reads as three sections rather than twenty-three flat
 * lines. Before any heading, cells sit at level 0.
 *
 * A code cell is an entry of its own so it can be jumped to, but `includeCode: false`
 * leaves only the headings — which is the default in the rail, because a long list of
 * code lines is what makes a table of contents unusable. A notebook with no headings
 * at all keeps its cells either way; an outline of nothing helps nobody.
 *
 * Setext headings (`Title` over `===`) are not read: they are rare in notebooks and
 * would need a second pass.
 * @param cells - normalized cells.
 * @param options - `includeCode: false` drops code and raw entries when headings exist.
 * @returns entries in document order, each with its cell index and level.
 */
export function notebookOutline(cells, options) {
  const includeCode = options === undefined || options.includeCode !== false
  const entries = []
  let headingLevel = 0
  let sawHeading = false
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (cell === null || typeof cell !== 'object') continue
    const lines = String(cell.source ?? '').split('\n')
    if (cell.kind === 'markdown') {
      let headings = 0
      for (const line of lines) {
        const heading = ATX_HEADING.exec(line)
        if (heading === null) continue
        const label = heading[2].trim()
        if (label.length === 0) continue
        headingLevel = heading[1].length
        sawHeading = true
        headings += 1
        entries.push({ index: cell.index, kind: 'heading', level: headingLevel, label })
      }
      // A prose cell is only an entry when the notebook has no headings at all.
      if (headings === 0 && !sawHeading) {
        const first = firstMeaningfulLine(lines)
        if (first !== undefined) entries.push({ index: cell.index, kind: 'markdown', level: 0, label: first })
      }
      continue
    }
    const first = firstMeaningfulLine(lines)
    const prompt =
      cell.kind === 'code'
        ? `In [${cell.executionCount === null || cell.executionCount === undefined ? ' ' : cell.executionCount}]`
        : cell.kind
    entries.push({
      index: cell.index,
      kind: cell.kind,
      level: sawHeading ? headingLevel + 1 : 0,
      label: first === undefined ? prompt : `${prompt} ${first}`
    })
  }
  // With no headings the list is the only navigation there is, so cells stay in it.
  if (!sawHeading || includeCode) return entries
  return entries.filter((entry) => entry.kind === 'heading')
}

/**
 * The text a cell can be found by.
 *
 * Source plus every textual part of its outputs. ANSI escapes are stripped so a
 * search for the visible text matches what is on screen.
 * @param cell - a normalized cell.
 * @returns the searchable text.
 */
export function cellSearchText(cell) {
  if (cell === null || typeof cell !== 'object') return ''
  const parts = [typeof cell.source === 'string' ? cell.source : '']
  for (const output of Array.isArray(cell.outputs) ? cell.outputs : []) {
    if (output === null || typeof output !== 'object') continue
    for (const field of ['text', 'name', 'value', 'note', 'mime', 'language']) {
      if (typeof output[field] === 'string') parts.push(output[field])
    }
  }
  return stripAnsi(parts.join('\n'))
}

/**
 * The cells a query matches, in document order.
 * @param cells - normalized cells.
 * @param query - the search text; a blank query matches nothing.
 * @returns the matching cell indices, 1-based as `cell.index` is.
 */
export function findCells(cells, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle.length === 0) return []
  const matches = []
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (cellSearchText(cell).toLowerCase().includes(needle)) matches.push(cell.index)
  }
  return matches
}

/**
 * The text a raw view shows for a notebook file.
 *
 * The file as saved is what a reader asking for "the raw JSON" wants, so this does
 * not re-serialize the parsed value — a re-encode would hide the file's real
 * formatting (and any part the parser dropped).
 * @param text - the decoded file text.
 * @param max - the character cap.
 * @returns the text to show and whether it was capped.
 */
export function rawViewText(text, max = LIMITS.previewRawChars) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= max) return { text: value, truncated: false }
  return { text: `${value.slice(0, max)}\n… (truncated)`, truncated: true }
}

/**
 * Build a `data:` URL for an image payload.
 * @param mime - the image MIME type.
 * @param payload - base64, or the raw document for `image/svg+xml`.
 * @returns the URL, or undefined for an empty payload.
 */
export function imageDataUrl(mime, payload) {
  const value = typeof payload === 'string' ? payload : ''
  if (value.length === 0) return undefined
  if (mime === 'image/svg+xml') return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`
  return `data:${mime};base64,${value.replace(/\s+/g, '')}`
}

/**
 * Resolve a markdown cell's `attachment:` reference against that cell's own
 * attachments. A notebook embeds these images in the cell itself, so they need no
 * file read and no Host path.
 * @param attachments - a normalized `attachments` map.
 * @param destination - the authored markdown destination.
 * @returns the data URL, or undefined when the reference is not an attachment here.
 */
export function attachmentDataUrl(attachments, destination) {
  if (attachments === null || typeof attachments !== 'object') return undefined
  const match = /^attachment:(.+)$/i.exec(typeof destination === 'string' ? destination : '')
  if (match === null) return undefined
  let name = match[1]
  try {
    name = decodeURIComponent(name)
  } catch {
    // A malformed escape keeps the literal name, which may still match a key.
  }
  const bundle = attachments[name] ?? attachments[match[1]]
  if (bundle === null || typeof bundle !== 'object') return undefined
  const mimes = Object.keys(bundle)
  const chosen = mimes.find(isImageMime) ?? mimes[0]
  if (chosen === undefined) return undefined
  return imageDataUrl(chosen, bundle[chosen])
}

/**
 * Normalize a parsed notebook.
 * @param raw - the parsed JSON value.
 * @returns the normal form.
 */
export function normalizeNotebook(raw) {
  const metadata = raw.metadata !== null && typeof raw.metadata === 'object' ? raw.metadata : {}
  const languageInfo = metadata.language_info !== null && typeof metadata.language_info === 'object' ? metadata.language_info : {}
  const kernelspec = metadata.kernelspec !== null && typeof metadata.kernelspec === 'object' ? metadata.kernelspec : {}
  const language = typeof languageInfo.name === 'string' ? languageInfo.name : typeof kernelspec.language === 'string' ? kernelspec.language : ''
  const kernel = typeof kernelspec.display_name === 'string'
    ? kernelspec.display_name
    : typeof kernelspec.name === 'string' ? kernelspec.name : language
  const cells = Array.isArray(raw.cells) ? raw.cells.map((cell, at) => normalizeCell(cell, at + 1)) : []
  return {
    nbformat: Number(raw.nbformat),
    nbformatMinor: Number(raw.nbformat_minor) || 0,
    language,
    kernel,
    cellCount: cells.length,
    cells
  }
}

/**
 * Parse notebook text into the normal form.
 * @param text - the notebook file's decoded text.
 * @returns `{ ok: true, notebook }` or `{ ok: false, error }` with a reason the
 * preview and the tool both show verbatim.
 */
export function parseNotebook(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'file is empty' }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not valid JSON (${error instanceof Error ? error.message : String(error)})` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'JSON root is not a notebook object' }
  }
  const version = Number(raw.nbformat)
  if (!Number.isFinite(version)) {
    return { ok: false, error: `unsupported nbformat ${JSON.stringify(raw.nbformat)}; expected 4 or newer` }
  }
  // An nbformat 3 notebook is old, not broken: it still opens in Jupyter, so
  // refusing it hides a readable file behind a message. It is up-converted instead,
  // and the conversion is a plain function of its own so it can be tested directly.
  const source = version < 4 ? upconvertNbformat3(raw) : raw
  if (source === undefined) {
    return { ok: false, error: `unsupported nbformat ${JSON.stringify(raw.nbformat)}; expected 4 or newer` }
  }
  if (!Array.isArray(source.cells)) {
    return { ok: false, error: 'notebook has no cells array' }
  }
  return { ok: true, notebook: normalizeNotebook(source) }
}

/** The nbformat 4 language and kernel metadata for an nbformat 3 notebook. */
function metadataFromV3(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {}
  const language = typeof source.language === 'string' ? source.language : undefined
  const name = typeof source.name === 'string' ? source.name : undefined
  const kernelspec = source.kernelspec !== null && typeof source.kernelspec === 'object' ? source.kernelspec : undefined
  return {
    ...(language === undefined ? {} : { language_info: { name: language } }),
    ...(kernelspec === undefined && name === undefined
      ? {}
      : {
        kernelspec: {
          ...(kernelspec ?? {}),
          ...(name === undefined ? {} : { display_name: name }),
          ...(language === undefined ? {} : { language })
        }
      })
  }
}

/** One nbformat 3 output as an nbformat 4 output. */
function outputFromV3(output) {
  if (output === null || typeof output !== 'object') return undefined
  const type = output.output_type
  if (type === 'stream') return output
  if (type === 'pyout') {
    return {
      output_type: 'execute_result',
      execution_count: typeof output.prompt_number === 'number' ? output.prompt_number : null,
      metadata: output.metadata ?? {},
      // v3 writes a text result as an array of line fragments, not a string.
      data: output.data ?? (output.text === undefined ? {} : { 'text/plain': joinSource(output.text) })
    }
  }
  if (type === 'pyerr') {
    return {
      output_type: 'error',
      ename: typeof output.ename === 'string' ? output.ename : 'Error',
      evalue: typeof output.evalue === 'string' ? output.evalue : '',
      traceback: Array.isArray(output.traceback)
        ? output.traceback
        : typeof output.traceback === 'string'
          ? [output.traceback]
          : []
    }
  }
  if (type === 'display_data' || type === 'execute_result') {
    const data = output.data !== null && typeof output.data === 'object' ? output.data : {}
    // A very old writer stored a bare PNG payload instead of a MIME bundle.
    if (typeof output.png === 'string' && data['image/png'] === undefined) {
      return { output_type: 'display_data', metadata: output.metadata ?? {}, data: { ...data, 'image/png': output.png } }
    }
    return { output_type: 'display_data', metadata: output.metadata ?? {}, data }
  }
  return undefined
}

/**
 * Convert an nbformat 3 notebook into the nbformat 4 shape this reader normalizes.
 *
 * nbformat 3 keeps cells inside `worksheets`, names a code cell's source `input`,
 * records its prompt as `prompt_number`, and writes an `execute_result` as `pyout`.
 * `heading` cells carry a level, which becomes markdown heading syntax.
 * @param raw - the parsed nbformat 3 value.
 * @returns a v4-shaped object, or undefined when there is nothing to convert.
 */
export function upconvertNbformat3(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const worksheets = Array.isArray(raw.worksheets) ? raw.worksheets : []
  const flat = []
  for (const worksheet of worksheets) {
    if (worksheet === null || typeof worksheet !== 'object') continue
    for (const cell of Array.isArray(worksheet.cells) ? worksheet.cells : []) flat.push(cell)
  }
  // A few writers put the cells at the top level even at version 3.
  if (flat.length === 0 && Array.isArray(raw.cells)) {
    return { ...raw, nbformat: 4, nbformat_minor: 5, metadata: metadataFromV3(raw.metadata) }
  }
  if (flat.length === 0) return undefined
  const cells = flat.map((cell) => {
    const type = cell !== null && typeof cell === 'object' ? cell.cell_type : undefined
    const common = { metadata: (cell !== null && typeof cell === 'object' ? cell.metadata : undefined) ?? {} }
    if (type === 'code') {
      const outputs = (cell.outputs ?? []).map(outputFromV3).filter((output) => output !== undefined)
      return {
        ...common,
        cell_type: 'code',
        source: joinSource(cell.input ?? cell.source),
        execution_count: typeof cell.prompt_number === 'number' ? cell.prompt_number : null,
        outputs
      }
    }
    if (type === 'heading') {
      const level = typeof cell.level === 'number' && cell.level > 0 ? Math.min(cell.level, 6) : 1
      const text = joinSource(cell.source ?? cell.text)
      return { ...common, cell_type: 'markdown', source: `${'#'.repeat(level)} ${text}` }
    }
    return {
      ...common,
      cell_type: type === 'markdown' ? 'markdown' : 'raw',
      source: joinSource(cell.source ?? cell.text ?? cell.input)
    }
  })
  return { nbformat: 4, nbformat_minor: 5, metadata: metadataFromV3(raw.metadata), cells }
}

/**
 * Cap text and report whether anything was dropped.
 * @param text - the source text.
 * @param max - the character cap.
 * @returns the capped text and its truncation flag.
 */
export function capText(text, max) {
  const value = typeof text === 'string' ? text : ''
  if (!Number.isFinite(max) || max <= 0) return { text: '', truncated: value.length > 0 }
  if (value.length <= max) return { text: value, truncated: false }
  return { text: value.slice(0, max), truncated: true }
}

/**
 * Project one normalized output into digest form. Bases4 payloads are embedded
 * only while they fit the image budget.
 * @param output - a normalized output.
 * @param options - `embedImageMaxBytes`, `maxChars`.
 * @returns the digest output plus the characters and embedded bytes it costs.
 */
export function digestOutput(output, options) {
  const maxChars = options.maxChars ?? LIMITS.cardOutputChars
  if (output.kind === 'stream') {
    const capped = capText(output.text, maxChars)
    return { output: { kind: 'stream', name: output.name, text: capped.text, truncated: capped.truncated }, chars: capped.text.length, bytes: 0 }
  }
  if (output.kind === 'error') {
    const capped = capText(output.text, maxChars)
    return { output: { kind: 'error', name: output.name, value: output.value, text: capped.text, truncated: capped.truncated }, chars: capped.text.length, bytes: 0 }
  }
  if (output.kind === 'html') {
    const capped = capText(output.text, maxChars)
    return { output: { kind: 'html', mime: output.mime, text: capped.text, chars: output.text.length, truncated: capped.truncated }, chars: capped.text.length, bytes: 0 }
  }
  if (output.kind === 'json') {
    const capped = capText(output.text, maxChars)
    if (capped.truncated) {
      return { output: { kind: 'text', mime: output.mime, text: capped.text, truncated: true }, chars: capped.text.length, bytes: 0 }
    }
    return { output: { kind: 'json', mime: output.mime, tree: output.tree }, chars: capped.text.length, bytes: 0 }
  }
  if (output.kind === 'text') {
    const capped = capText(output.text, maxChars)
    return { output: { kind: 'text', mime: output.mime, text: capped.text, truncated: capped.truncated }, chars: capped.text.length, bytes: 0 }
  }
  if (output.kind === 'image') {
    if (output.mime === 'image/svg+xml') {
      const capped = capText(output.svg, maxChars)
      return { output: { kind: 'image', mime: output.mime, svg: capped.text, bytes: output.bytes, truncated: capped.truncated }, chars: capped.text.length, bytes: output.bytes }
    }
    if (output.bytes <= (options.embedImageMaxBytes ?? LIMITS.cardEmbedImageMaxBytes)) {
      return { output: { kind: 'image', mime: output.mime, base64: output.base64, bytes: output.bytes }, chars: 0, bytes: output.bytes }
    }
    return { output: { kind: 'image-placeholder', mime: output.mime, bytes: output.bytes }, chars: 0, bytes: 0 }
  }
  return { output: { kind: 'unsupported', note: output.note }, chars: 0, bytes: 0 }
}

/**
 * Build the digest the tool card renders and the model-facing text is derived
 * from. It is size-bounded: `truncated` records every dropped cell or output.
 * @param notebook - a normalized notebook.
 * @param options - overrides for {@link LIMITS}.
 * @returns the digest, a lossless-JSON value.
 */
export function buildDigest(notebook, options = {}) {
  const maxCells = options.cardMaxCells ?? LIMITS.cardMaxCells
  const maxChars = options.cardMaxChars ?? LIMITS.cardMaxChars
  const sourceChars = options.cardCellSourceChars ?? LIMITS.cardCellSourceChars
  const embedImageMaxBytes = options.cardEmbedImageMaxBytes ?? LIMITS.cardEmbedImageMaxBytes
  const cells = []
  let used = 0
  let truncated = false
  for (const cell of notebook.cells) {
    if (cells.length >= maxCells) {
      truncated = true
      break
    }
    const source = capText(cell.source, sourceChars)
    if (source.truncated) truncated = true
    if (used + source.text.length > maxChars) {
      truncated = true
      break
    }
    used += source.text.length
    if (cell.kind !== 'code') {
      cells.push({ i: cell.index, kind: cell.kind, source: source.text, sourceTruncated: source.truncated })
      continue
    }
    const outputs = []
    for (const raw of cell.outputs) {
      const budget = Math.max(0, Math.min(LIMITS.cardOutputChars, maxChars - used))
      const projected = digestOutput(raw, { maxChars: budget, embedImageMaxBytes })
      used += projected.chars
      if (projected.output.truncated === true) truncated = true
      outputs.push(projected.output)
    }
    cells.push({
      i: cell.index,
      kind: 'code',
      exec: cell.executionCount,
      // One number per cell, so the card can show the run time as the preview does.
      ...(cell.durationMs === undefined ? {} : { ms: cell.durationMs }),
      source: source.text,
      sourceTruncated: source.truncated,
      outputs
    })
  }
  return {
    v: 1,
    nbformat: notebook.nbformat,
    nbformatMinor: notebook.nbformatMinor,
    language: notebook.language,
    kernel: notebook.kernel,
    cellCount: notebook.cellCount,
    truncated,
    cells
  }
}

/**
 * Describe one digest output on a single line for the model-facing projection.
 * @param output - one digest output.
 * @returns the description.
 */
export function describeDigestOutput(output) {
  if (output.kind === 'stream') return `${output.name}: ${output.text}`
  if (output.kind === 'error') return `${output.name}: ${output.value}`
  if (output.kind === 'html') return `[html output, ${output.chars} chars]`
  if (output.kind === 'json') return `[json output] ${JSON.stringify(output.tree)}`
  if (output.kind === 'text') return `${output.mime}: ${output.text}`
  if (output.kind === 'image') return `[image output ${output.mime}, ${output.bytes} bytes]`
  if (output.kind === 'image-placeholder') return `[image output ${output.mime}, ${output.bytes} bytes; open the preview to view it]`
  return `[${output.note}]`
}

/**
 * Project a digest into the compact text the model reads. Source and outputs
 * are capped again so one notebook cannot flood a context.
 * @param digest - a digest from {@link buildDigest}.
 * @param options - overrides for {@link LIMITS}.
 * @returns the text.
 */
export function buildToolText(digest, options = {}) {
  const maxChars = options.toolMaxOutputChars ?? LIMITS.toolMaxOutputChars
  const sourceChars = options.toolCellSourceChars ?? LIMITS.toolCellSourceChars
  const outputChars = options.toolOutputChars ?? LIMITS.toolOutputChars
  const lines = []
  lines.push(`<notebook cells="${digest.cellCount}" nbformat="${digest.nbformat}.${digest.nbformatMinor}" language="${digest.language || 'unknown'}" kernel="${digest.kernel || 'unknown'}">`)
  for (const cell of digest.cells) {
    const label = cell.kind === 'code'
      ? `code In[${cell.exec === null || cell.exec === undefined ? ' ' : cell.exec}]`
      : cell.kind
    const source = capText(cell.source, sourceChars)
    lines.push(`--- cell ${cell.i} (${label}) ---`)
    lines.push(source.text + (source.truncated ? ' …[source truncated]' : ''))
    for (const output of cell.outputs ?? []) {
      const described = describeDigestOutput(output)
      lines.push(capText(described, outputChars).text + (described.length > outputChars ? ' …[output truncated]' : ''))
    }
  }
  lines.push('</notebook>')
  const body = lines.join('\n')
  const capped = capText(body, maxChars)
  return capped.truncated ? `${capped.text}\n…[notebook output truncated; read specific cells with the cells argument]` : body
}

/**
 * Expand a Jupyter-style cell selector. Accepts `1-based` numbers, `a-b`
 * ranges, and comma or whitespace separators; overlapping entries collapse and
 * the result is ascending.
 * @param spec - the selector text, or undefined for every cell.
 * @param cellCount - the notebook's cell count.
 * @returns the selected 1-based cell numbers, or an empty array for a selector
 * that matches nothing.
 */
export function parseCellSelector(spec, cellCount) {
  if (typeof spec !== 'string' || spec.trim().length === 0) return []
  const picked = new Set()
  for (const rawPart of spec.split(',')) {
    const part = rawPart.trim()
    if (part.length === 0) continue
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      const lo = Math.max(1, Math.min(from, to))
      const hi = Math.min(cellCount, Math.max(from, to))
      for (let at = lo; at <= hi; at += 1) picked.add(at)
      continue
    }
    if (/^\d+$/.test(part)) {
      const at = Number(part)
      if (at >= 1 && at <= cellCount) picked.add(at)
    }
  }
  return [...picked].sort((a, b) => a - b)
}

/**
 * Keep only the selected cells of a normal form notebook.
 * @param notebook - a normalized notebook.
 * @param spec - the selector text; undefined keeps every cell.
 * @returns the filtered notebook.
 */
export function selectCells(notebook, spec) {
  if (typeof spec !== 'string' || spec.trim().length === 0) return notebook
  const wanted = new Set(parseCellSelector(spec, notebook.cellCount))
  return { ...notebook, cells: notebook.cells.filter((cell) => wanted.has(cell.index)) }
}

/**
 * Whether an image is actually being constrained by its pane.
 *
 * The zoom affordance is only honest when it has something to reveal: a figure
 * smaller than the pane renders at its intrinsic size either way, so offering
 * "view actual size" there is a control that cannot do anything.
 * @param naturalWidth - the image's intrinsic width in CSS pixels.
 * @param naturalHeight - the image's intrinsic height in CSS pixels.
 * @param availableWidth - the width the pane can give it.
 * @param viewportHeight - the viewport height, for the tall-image cap.
 * @param maxViewportFraction - the fraction of the viewport a fitted image may take.
 * @returns whether fitting the image shrinks it.
 */
export function imageIsConstrained(naturalWidth, naturalHeight, availableWidth, viewportHeight, maxViewportFraction = 0.7) {
  const sizes = [naturalWidth, naturalHeight, availableWidth, viewportHeight]
  if (!sizes.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return false
  if (naturalWidth > availableWidth) return true
  return naturalHeight > viewportHeight * maxViewportFraction
}

/**
 * Addressing a notebook's own files.
 *
 * Implemented here rather than imported: the web shell seeds a fixed module table,
 * and the workspace-path helpers the preview owner resolves figures with are not in
 * it — a bundle that `require`s them fails to materialize at all, taking the whole
 * client half down with it. What this plugin actually needs is small: is a native
 * path absolute, is an authored destination a scheme or a path, and what is the file
 * route URL for an absolute path on the app's own base.
 */

/** A Windows drive prefix (`C:\` or `C:/`). */
const DRIVE_PREFIX = /^[A-Za-z]:[/\\]/

/** A URL scheme prefix, e.g. `https:`, `data:`. A drive letter matches this too. */
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/

/** Control characters, which no addressable native path may contain. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** A drive-letter prefix. */
function hasDrivePrefix(value) {
  return DRIVE_PREFIX.test(value)
}

/** A UNC prefix, in either separator style. */
function hasUncPrefix(value) {
  return value.startsWith('\\\\') || value.startsWith('//')
}

/**
 * Whether a native path is already absolute.
 * @param path - the path to inspect.
 * @returns whether it is absolute.
 */
export function isAbsoluteWorkspacePath(path) {
  return path.startsWith('/') || hasDrivePrefix(path) || path.startsWith('\\\\')
}

/**
 * Split a native path into its directory (keeping the trailing separator) and its
 * final segment.
 * @param path - the path to split.
 * @returns the directory and the final segment.
 */
export function pathPartsOf(path) {
  const trimmed = path.replace(/[/\\]+$/, '')
  if (trimmed.length === 0) return { directory: '', name: path }
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (separator === -1) return { directory: '', name: trimmed }
  return { directory: trimmed.slice(0, separator + 1), name: trimmed.slice(separator + 1) }
}

/**
 * Address an absolute native path through the authenticated file route.
 * @param base - an HTTP(S) application base, or `dsh-app://app/`.
 * @param path - a native path.
 * @returns the file URL, or undefined for an unsupported transport or path.
 */
export function fileMediaUrl(base, path) {
  if (!/^https?:/i.test(base) && !base.startsWith('dsh-app://app/')) return undefined
  if (!isAbsoluteWorkspacePath(path)) return undefined
  // A UNC path names another host, which this route does not serve.
  if (hasUncPrefix(path)) return undefined
  if (CONTROL_CHARACTERS.test(path)) return undefined
  try {
    return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href
  } catch {
    // A base this deployment reports but `URL` cannot parse is not addressable.
    return undefined
  }
}

/**
 * Address an authored markdown image destination, so a notebook's relative figures
 * resolve the way they do in the built-in markdown renderer: a query or fragment is
 * dropped, the destination is decoded once, a real scheme is left to the renderer,
 * and a relative path joins the document's own directory.
 * @param base - the document's base URL.
 * @param documentPath - the notebook's absolute path, when one was reported.
 * @param destination - the authored markdown destination.
 * @returns the file URL, or undefined when the destination cannot be addressed.
 */
export function markdownImageUrl(base, documentPath, destination) {
  const cut = destination.search(/[?#]/)
  let decoded
  try {
    decoded = decodeURIComponent(cut === -1 ? destination : destination.slice(0, cut))
  } catch {
    // A malformed escape is not an addressable destination.
    return undefined
  }
  if (decoded.length === 0) return undefined
  // A scheme belongs to whoever authored it — a Windows drive letter is not one.
  if (!hasDrivePrefix(decoded) && SCHEME_PREFIX.test(decoded)) return undefined
  if (isAbsoluteWorkspacePath(decoded)) return fileMediaUrl(base, decoded)
  if (documentPath === undefined) return undefined
  return fileMediaUrl(base, pathPartsOf(documentPath).directory + decoded)
}

/**
 * One-line summary of a digest for a card header.
 *
 * The copy arrives from the caller: this is user-facing text in the chat card, so
 * it must not be a hard-coded English string in a localized product.
 * @param digest - a digest from {@link buildDigest}.
 * @param strings - localized templates; `{n}` is replaced with the count.
 * @returns the summary text.
 */
export function digestSummary(digest, strings) {
  const text = strings ?? { cells: '{n} cells', code: '{n} code', executed: '{n} executed', truncated: 'truncated' }
  const fill = (template, count) => String(template).replace('{n}', String(count))
  const executed = digest.cells.filter((cell) => cell.kind === 'code' && cell.exec !== null && cell.exec !== undefined).length
  const codes = digest.cells.filter((cell) => cell.kind === 'code').length
  const parts = [fill(text.cells, digest.cellCount), fill(text.code, codes), fill(text.executed, executed)]
  if (digest.language) parts.push(digest.language)
  if (digest.truncated) parts.push(text.truncated)
  return parts.join(' · ')
}
