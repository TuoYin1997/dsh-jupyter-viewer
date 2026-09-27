# dsh-jupyter-viewer

**English** · [简体中文](README.zh-CN.md)

Render Jupyter notebooks inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
instead of reading `nbformat` JSON: a real `.ipynb` preview, plus a `read_notebook` tool that hands the
model content rather than raw JSON.

## What it adds

**A `.ipynb` document preview** in the right Sidebar's document tab.

- Markdown cells through the product's own GFM + KaTeX renderer; code cells highlighted with their
  `In [n]` counters; outputs rendered by type — stdout/stderr with ANSI colors, results, `text/html`
  tables, images, `text/latex` math, `application/json`, and error tracebacks.
- A contents rail, find with in-output highlighting, **View raw JSON**, per-cell run times, cell tags,
  and Jupyter's `collapsed` / `source_hidden` flags.
- Relative markdown images (`![](figs/a.png)`) resolve against the notebook's own directory.
- `Plain text` stays in the renderer dropdown as an escape hatch; the notebook renderer is the default.

**A `read_notebook` tool.** The model receives a bounded structured digest — never raw JSON, never
base64 — and the conversation shows a notebook card with an **Open in preview** action. Use it instead
of `read` for `.ipynb` files.

## Install

Installing the package as a bundle wires the `jupyter-notebook` row from `cordis.patch.yml` for you:

- **Plugin manager** — Settings → Plugins, or the `plugin_manager` tool, with the package name or a
  local installation spec.
- **Manual profile dependency** — install the package so the profile can resolve it, then copy the row
  from `cordis.patch.yml` into the profile's own `cordis.patch.yml` `insert` list.

Both the Node half and the browser half load from that one row. If your deployment does not re-scan the
profile patch, restart the Harness and refresh the page once.

## Distributing it

`npm publish` is the best experience; otherwise `npm pack` produces the same tarball:

```bash
npm publish
npm pack                       # -> dsh-jupyter-viewer-0.1.0.tgz
```

The recipient installs it through Settings → Plugins (or `plugin_manager`'s `install_bundle` action)
with the tarball path or `github:TuoYin1997/dsh-jupyter-viewer`. For a checkout, make the package
resolvable from the profile's `node_modules` (clone, copy, or junction) and add the row by hand. There
is **no `dsh` CLI** in the desktop build, so those are the only routes.

The package has **no runtime npm dependencies**: the browser half requires only `react` and
`@deepseek-ai/dsh-client-ui-primitives`, both seeded by the web shell, and the Node half imports only
`src/notebook.js` from inside the package. `lib/client.js` is committed and `prepack` proves it current,
so a stale bundle fails the pack instead of reaching a user.

### Recipient checklist

1. The Harness must compose the document preview (`ui-sidebar-documentpreview`). Without it the preview
   degrades to a console warning; the tool card still works.
2. Only one row may own the id `jupyter-notebook` — change it if you install a fork alongside this one.
3. After the reload, confirm both halves: `read_notebook` in the tool list, and `active: true` for
   `jupyter-notebook` under client `Slots` / `sidebar.right.tab.document`.
4. **Version coupling.** The label contracts were read from DSH `0.1.7-rc.2`, which `engines.dsh`
   declares. Run `npm test` after installing: the throwing stubs encode those contracts, so a Harness
   that changed them fails the suite instead of the browser.

## Limits

| What | Value | Where |
|---|---|---|
| Cells in a digest | 200 | `LIMITS.cardMaxCells` |
| Characters in a digest | 32768 | `LIMITS.cardMaxChars` |
| Image embedded in a digest | 64 KiB (larger ones keep their byte size only) | `LIMITS.cardEmbedImageMaxBytes` |
| Cells the preview draws at once | 300 (then **Show all cells**) | `LIMITS.previewMaxCells` |
| HTML output rendered in a frame | 512 KiB (larger renders as text) | `LIMITS.previewMaxHtmlChars` |
| HTML frame height | measured from content, clamped to 70% of the viewport | `HTML_FRAME_*` |
| Image output height | at most 70vh, never enlarged past its intrinsic size | `S.image` |
| Notebook file size the tool reads | 32 MiB | `lib/index.js` |

`read_notebook` takes `file_path`, `cells` (`"1-5,8"`), `include_outputs`, and `max_chars`.

## Security

`text/html` outputs are untrusted notebook content. They render in an
`<iframe sandbox="allow-same-origin">` with **scripts disabled**, so the framed markup cannot execute,
navigate this page, or read anything of this origin; the only grant is the parent's read access, which
the frame measurement needs. SVG renders through `<img>`. Path authorization belongs to `ctx.fs`,
exactly as it does for the built-in `read` tool.

## Known limitations

- **Relative images resolve in the preview, not in the chat card.** An `attachment:` image is the
  exception — the notebook embeds it in the cell, so the card renders it too.
- **A relative `src`/`href`/`srcset` inside an HTML output is rewritten, not resolved by the frame** —
  each addressable reference is joined to the notebook's directory and pointed at the file route.
- **Widget outputs are placeholders.** `application/vnd.jupyter.widget-view+json` and other unranked
  MIME types show a one-line note naming the type.
- **The chat card shows small images only.** Larger ones render as "Image output (12.3 KiB); open the
  preview tab to view it".
- **An HTML output is inert by design.** Scripts inside it never run, so outputs that depend on them
  show only their static markup.
- **A traceback keeps its frame colors.** Jupyter colors traceback frames, so the raw traceback is kept
  alongside the plain text.
- **An `nbformat` 3 notebook is up-converted, not refused.** Versions newer than 4 are read as 4.
- **A nested table is not expanded.** `tableToTsv` converts only the first table and does not expand
  `colspan`/`rowspan`.

## Development

```bash
node scripts/run-tests.mjs        # all suites, in this process
node scripts/build-client.mjs     # regenerate lib/client.js
node scripts/build-client.mjs --check
node --check lib/client.js
```

Edit `src/notebook.js` or `src/client-ui.js` and rebuild — `lib/client.js` is generated, and `--check`
fails when the artifact is stale. `src/notebook.js` is the single source of truth for both halves, so
the preview and the card cannot parse a notebook differently.

## Going deeper

How the plugin attaches to the Harness, why the rendering behaves the way it does, which alternatives
were rejected, and what the suite can and cannot prove: [docs/DESIGN.md](docs/DESIGN.md).
