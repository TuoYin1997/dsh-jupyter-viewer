/**
 * Node half of `dsh-jupyter-viewer`: the `read_notebook` tool.
 *
 * The definition is a plain `ToolRuntime` object rather than a `defineTool`
 * result, because a plugin installed outside the deployment's own
 * `node_modules` must not depend on resolving `@deepseek-ai/dsh-tools` from its
 * own tree — the shipped `@deepseek-ai/dsh-mcp-client` registers the same shape
 * for schemas it receives at runtime, which is what this mirrors.
 *
 * `execute` returns the JSON digest as the canonical string value. Two
 * projections derive from that one artifact: `output.render` produces the
 * compact text the model reads (no base64 ever), and
 * `output.presentationMeta` emits the digest as the durable per-call
 * presentation metadata the browser tool card renders from — so the card needs
 * no second file read and replays from the session log.
 */
import { LIMITS, buildDigest, buildToolText, parseNotebook, selectCells } from '../src/notebook.js'

/** The wire name the tool card is keyed by. */
export const TOOL_NAME = 'read_notebook'

/** Read cap; a notebook above this is refused rather than truncated silently. */
const MAX_NOTEBOOK_BYTES = 32 * 1024 * 1024

const PARAMETERS = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Path to the .ipynb file. A relative path resolves against the session working directory.'
    },
    cells: {
      type: 'string',
      description: 'Optional 1-based cell selection such as "1-5,8". Omit to read every cell.'
    },
    include_outputs: {
      type: 'boolean',
      description: 'Include cell outputs (stdout, results, images, errors). Defaults to true.'
    },
    max_chars: {
      type: 'number',
      description: 'Maximum characters of rendered notebook text to return. Defaults to 20000.'
    }
  },
  required: ['file_path']
}

const DESCRIPTION = [
  'Read a Jupyter notebook (.ipynb) as rendered content instead of raw JSON.',
  '',
  'Returns markdown cells, code cells with their execution counts, and cell outputs (streams,',
  'results, images, errors) as compact text. Use this instead of `read` for any .ipynb file:',
  '`read` returns the underlying JSON, which wastes context and hides the structure.',
  '',
  'Image outputs are described by MIME type and byte size, never inlined. Use the `cells`',
  'argument to read only the cells you need from a large notebook.'
].join('\n')

/** One error message shape, matching the harness normalization of a thrown tool failure. */
function fail(reason) {
  return new Error(reason)
}

/**
 * The canonical digest for one notebook file.
 * @param ctx - the plugin context, carrying the composed filesystem.
 * @param args - validated arguments.
 * @param exec - the execution identity and caller.
 * @returns the digest as a JSON string.
 */
async function readNotebook(ctx, args, exec) {
  const raw = typeof args.file_path === 'string' ? args.file_path.trim() : ''
  if (raw.length === 0) throw fail('file_path must be a non-empty string')

  const session = exec !== null && exec !== undefined && exec.agent !== null && exec.agent !== undefined ? exec.agent.session : undefined
  const cwd = session !== undefined && session !== null && session.header !== undefined ? session.header.cwd : undefined
  if (cwd === undefined || cwd === null || cwd === '') throw fail('the calling session has no working directory')

  let target
  try {
    target = await ctx.fs.resolve(raw, { cwd, signal: exec.signal })
  } catch (error) {
    throw fail(`could not resolve ${raw}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let bytes
  try {
    bytes = await ctx.fs.readBytes(target, exec.signal, MAX_NOTEBOOK_BYTES)
  } catch (error) {
    throw fail(`could not read ${raw}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (bytes === undefined || bytes === null || bytes.byteLength === 0) throw fail(`${raw} is empty`)

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw fail(`${raw} is not valid UTF-8 text; .ipynb files are JSON documents`)
  }

  const parsed = parseNotebook(text)
  if (!parsed.ok) throw fail(`${raw} is not a readable notebook: ${parsed.error}`)

  const selected = selectCells(parsed.notebook, args.cells)
  if (selected.cells.length === 0 && parsed.notebook.cellCount > 0) {
    throw fail(`the cells selector ${JSON.stringify(args.cells)} matched none of the ${parsed.notebook.cellCount} cells`)
  }

  const digest = buildDigest(selected)
  digest.path = raw
  if (args.include_outputs === false) {
    for (const cell of digest.cells) if (Array.isArray(cell.outputs)) cell.outputs = []
  }
  return JSON.stringify(digest)
}

/**
 * Build the registry-ready definition bound to one plugin context.
 * @param ctx - the plugin context, carrying the composed filesystem.
 * @returns the definition registered on `ctx.tools`.
 */
export function createReadNotebookTool(ctx) {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'string' },
      render(args, value) {
        let digest
        try {
          digest = JSON.parse(value)
        } catch {
          return [{ type: 'text', text: String(value) }]
        }
        const requested = typeof args === 'object' && args !== null && typeof args.max_chars === 'number' ? args.max_chars : undefined
        const cap = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200000) : LIMITS.toolMaxOutputChars
        return [{ type: 'text', text: buildToolText(digest, { toolMaxOutputChars: cap }) }]
      },
      presentationMeta(_args, value) {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      }
    },
    async execute(args, exec) {
      return readNotebook(ctx, args, exec)
    }
  }
}

/** Cordis services this row needs; the filesystem enforces path authorization. */
export const inject = ['tools', 'fs']

/**
 * Register the tool.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.tools.register(createReadNotebookTool(ctx))
}
