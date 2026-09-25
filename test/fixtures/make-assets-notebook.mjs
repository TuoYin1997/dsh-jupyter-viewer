/**
 * Regenerate `assets.ipynb`, the fixture that exercises the reference and
 * formatting features which cannot be judged from the source alone:
 *
 *  1. an image embedded in the cell itself (`attachment:`)
 *  2. an image next to the notebook (a relative markdown path)
 *  3. an HTML output referencing a relative file (the `srcDoc` base-URL rewrite)
 *  4. a carriage-return progress bar (collapsed to its last frame)
 *  5. ANSI-colored stream output
 *  6. a `text/markdown` output (rendered, not shown as source)
 *
 * Run:  node test/fixtures/make-assets-notebook.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (name) => fileURLToPath(new URL(name, import.meta.url))
const figure = readFileSync(here('sample-figure.png')).toString('base64')

const notebook = {
  cells: [
    {
      cell_type: 'markdown',
      metadata: {},
      source: [
        '# Assets\n',
        '\n',
        'Embedded in the cell itself (`attachment:` — needs no Host path):\n',
        '\n',
        '![embedded](attachment:inline.png)\n'
      ],
      attachments: { 'inline.png': { 'image/png': figure } }
    },
    {
      cell_type: 'markdown',
      metadata: {},
      source: ['Next to the notebook (a relative markdown path):\n', '\n', '![relative](sample-figure.png)\n']
    },
    {
      cell_type: 'code',
      execution_count: 1,
      metadata: {},
      source: ['# an HTML output that references a file beside the notebook\n', 'HTML(figure_html)\n'],
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: {
            'text/html':
              '<figure style="margin:0">'
              + '<img src="sample-figure.png" style="width:320px">'
              + '<figcaption style="font-size:12px;opacity:.7">HTML output referencing a relative file</figcaption>'
              + '</figure>'
          }
        }
      ]
    },
    {
      cell_type: 'code',
      execution_count: 2,
      // Jupyter records the run's timestamps; the preview shows the difference.
      metadata: {
        execution: {
          'iopub.execute_input': '2026-01-06T09:15:00.000000Z',
          'iopub.status.busy': '2026-01-06T09:15:00.000000Z',
          'shell.execute_reply': '2026-01-06T09:15:12.400000Z'
        }
      },
      source: ['# a progress bar: only the last frame should show\n', 'for step in range(50): ...\n'],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: '  0%|          | 0/50\r 40%|####      | 20/50\r100%|##########| 50/50\r\ndone\n'
        }
      ]
    },
    {
      cell_type: 'code',
      execution_count: 3,
      metadata: {},
      source: ['# ANSI colors should survive\n', 'print(colored_report)\n'],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: 'plain \u001b[32mPASS\u001b[0m \u001b[1;31mFAIL\u001b[0m \u001b[4munderlined\u001b[0m\n'
        }
      ]
    },
    {
      cell_type: 'code',
      execution_count: 4,
      metadata: {},
      source: ['# a text/markdown output should render, not print its source\n', 'Markdown(summary)\n'],
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: {
            'text/markdown': '## Rendered markdown output\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- one\n- two\n'
          }
        }
      ]
    },
    {
      cell_type: 'code',
      execution_count: 5,
      metadata: { collapsed: true },
      source: ['# this cell was saved collapsed: the output starts hidden\n', 'long_log()\n'],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: 'a long log the user collapsed in Jupyter\n'.repeat(4)
        }
      ]
    },
    {
      cell_type: 'code',
      execution_count: 6,
      metadata: { tags: ['parameters', 'papermill'] },
      source: ['# tagged cells should show their tags as chips\n', 'theta = 0.5\n'],
      outputs: [{ output_type: 'execute_result', execution_count: 6, metadata: {}, data: { 'text/plain': '0.5' } }]
    },
    {
      cell_type: 'code',
      execution_count: 7,
      metadata: { jupyter: { outputs_hidden: true } },
      source: ['# Jupyter hid this output in the notebook itself\n', 'noisy()\n'],
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'hidden upstream\n' }]
    }
  ],
  metadata: {
    kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
    language_info: { name: 'python', version: '3.12.0' }
  },
  nbformat: 4,
  nbformat_minor: 5
}

writeFileSync(here('assets.ipynb'), `${JSON.stringify(notebook, null, 1)}\n`, 'utf8')
console.log(`wrote assets.ipynb: ${notebook.cells.length} cells, ${figure.length} base64 chars embedded`)
