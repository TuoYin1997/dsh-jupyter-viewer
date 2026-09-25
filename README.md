# dsh-jupyter-viewer

Render Jupyter notebooks inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
instead of looking at `nbformat` JSON.

A `.ipynb` file is a JSON document, so every file viewer without a notebook renderer shows you the
raw structure. This plugin adds one, and it also gives the model a tool that reads a notebook as
content rather than as JSON.

## What it adds

**A document preview for `.ipynb`.** Notebooks open in the right Sidebar's document tab rendered as
notebooks: markdown cells through the product's own GFM + KaTeX renderer, code cells syntax
highlighted with their `In [n]` counters, and outputs rendered by type — stdout/stderr, results,
`text/html` tables, `image/png|jpeg|gif|webp|svg+xml`, `text/latex` typeset as math,
`application/json`, and error tracebacks. A cell is a two-column grid with the Jupyter prompt in a
gutter; a long output collapses behind a control; an image is fitted to the pane and offers its
actual size; and a relative markdown image (`![](figs/a.png)`) resolves against the notebook's own
directory through the authenticated file route. `Plain text` stays available in the renderer dropdown
as an escape hatch; the notebook renderer is the default because it registers at the `extension`
band, which outranks the builtin text fallback.

**A `read_notebook` tool.** When the agent reads a notebook, it gets a compact structured digest
(never raw JSON, never base64) and the conversation shows a notebook card with an
**Open in preview** action. Use this instead of `read` for `.ipynb` files.

## Install

The package ships a bundle patch (`cordis.patch.yml`), so installing it as a bundle wires the row
`jupyter-notebook` for you. Either path works:

- **Plugin manager** (Settings → Plugins, or the `plugin_manager` tool) with the package name or a
  local installation spec.
- **Manual profile dependency**: install the package so the profile can resolve it, then add the row
  from `cordis.patch.yml` to the profile's own `cordis.patch.yml` `insert` list.

Both the Node half and the browser half are loaded from the same row.

**Reloading.** The desktop Harness watched the profile patch: adding the row made the Node half
register `read_notebook` and the browser half register both slot entries with no restart, and a fresh
tool call then rendered the card. If your deployment does not re-scan the profile, restart the
Harness and refresh the page once — the browser bundle is served from the enabled Loader entry, and
later `lib/client.js` edits are picked up by the HMR receiver only while a `dsh` source checkout runs
`pnpm run dev:web`.

## Distributing it to another Harness

The package has **no runtime npm dependencies**. The browser half `require`s only `react` and
`@deepseek-ai/dsh-client-ui-primitives`, both seeded statically by the web shell, and the Node half
imports only `src/notebook.js` from inside the package — so a recipient needs the package files and
nothing else resolved from a registry.

`lib/client.js` is a committed build artifact. It must be up to date in whatever you ship;
`prepack`/`prepublishOnly` run `build-client.mjs --check` plus the suite, so a stale bundle fails the
pack instead of reaching a user.

Three channels, in increasing order of friction:

**1. Registry (best UX).** Published as `dsh-jupyter-viewer` — the recipient installs it as a bundle and
`dsh.bundle.patch` makes the plugin self-wiring, so there is no profile edit to hand over:

```bash
npm publish
# recipient:
#   Settings → Plugins → install   (or the plugin_manager install_bundle action)
```

**2. Tarball or git checkout (works today, no registry).** `npm pack` produces the tarball the first
route installs, with no manifest change:

```bash
npm pack                       # -> dsh-jupyter-viewer-0.1.0.tgz
```

The recipient installs it the way any plugin is installed in the desktop Harness — there is **no `dsh`
CLI in the desktop build** (its manifest declares no `bin`), so the two working routes are:

- **Settings → Plugins**, or the `plugin_manager` tool's `install_bundle` action, with the tarball path
  or `github:TuoYin1997/dsh-jupyter-viewer` as the spec; or
- **resolve it in the profile and add the row**: make the package resolvable from
  `…/.dsh/profiles/<profile>/node_modules` (a `git clone`, a copied directory, or a junction to one),
  then add the row from `cordis.patch.yml` to that profile's own `cordis.patch.yml` `insert` list.

Both routes need the same row, because the bundle patch wires `jupyter-notebook` for you.

**3. A working copy (development / intranet).** Point a junction or symlink in the profile's
`node_modules` at the checkout and add the row. That is how this plugin is wired on the machine it was
written on, so it is the one route that has been used end to end.

`src/` must stay in the published files: `lib/index.js` imports `../src/notebook.js`. `npm pack
--dry-run --json` is the way to confirm what a recipient actually receives.

### Recipient checklist

1. The Harness must compose the document preview — the `ui-sidebar-documentpreview` row, which
   `dsh-web-app` supplies. Without it the preview degrades to a console warning and the tool card
   still works.
2. Only one row may own the id `jupyter-notebook`; change it before installing a fork alongside this
   one.
3. Confirm both halves after the reload: `read_notebook` in the tool list, and an `active: true`
   occupant for `jupyter-notebook` under client `Slots` / `sidebar.right.tab.document`.
4. **Version coupling.** The label contracts in *Caller-supplied copy on the shared primitives* were
   read from DSH `0.1.7-rc.2`, which `engines.dsh` declares. On a different Harness version the atoms
   may read different props, and a mismatch surfaces as a render error inside the card rather than a
   silent failure — that is what `Guard` is for. Run `npm test` after installing: the throwing stubs
   encode those contracts, so a version that changed them fails the suite instead of the browser.

## How it plugs in

The preview is a `documentPreviews` implementation (`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`),
not a second document tab:

```js
ctx.documentPreviews.register({
  id: 'jupyter-notebook',
  extensions: ['ipynb'],
  priority: 'extension',
  title: () => 'Jupyter Notebook',
  loading: 'bytes-complete',
  wrap: true
})
```

and a body under the same id in the Session-scoped keyed slot `sidebar.right.tab.document`. The
preview owner keeps every shared behaviour — bounded reads, file version watching, automatic
refresh, reload, the path header, the renderer dropdown — so this plugin only decodes and draws.
Declaring `wrap: true` is what gives the tab its wrap control; the body then honours the owner's
preference for both code and text output.

`bytes-complete` is deliberate: parsing needs the whole document, and the paged `text-pages` mode
would ask the reader to click **Load more** through a notebook before anything rendered.

The card is a `tool.call.toolview` entry keyed `read_notebook`. The Node half returns the digest as
its canonical value and declares both projections:

- `output.render` derives the compact model-facing text (no base64, size capped), and
- `output.presentationMeta` publishes the digest as durable per-call metadata, which is what the
  card renders from.

That split is why the card can replay from the session log without reading the file again, and why
an image never reaches the model.

### Caller-supplied copy on the shared primitives

The atoms (`MarkdownText`, `CodeBlock`, `JsonTree`) are locale-free: every label arrives through
props, and **the deployed 0.1.7 versions dereference them instead of defaulting** — even where the
0.1.0 `.d.ts` in `profiles/node_modules` marks them optional. A missing label object is therefore a
render crash, not a cosmetic gap. The three contracts this plugin satisfies:

| Atom | Prop | Shape the deployed code reads |
|---|---|---|
| `MarkdownText` | `labels` | `labels.code.copyLabel`, `labels.code.copiedLabel`, `labels.footnotes` (string) |
| `CodeBlock` | `copyLabel`, `copiedLabel` | strings rendered as the banner button's children |
| `CodeBlock` | `toolbarLabels` | `{ codeLabel, wrapLabel, unwrapLabel }` — supplying it selects the richer `CodeToolbar` banner instead of the plain one |
| `JsonTree` | `labels` | all ten `JsonTreeLabels` keys, with `copyButtonTitle(action)` a **function** |

`CodeBlock` is left without `toolbarLabels` on purpose: that prop gates the richer `CodeToolbar`,
whose own label object this plugin has not verified, while its absence selects the plain banner that
needs only the two copy strings.

Each object is built once in `apply` and shared by every cell — the atoms' own contract notes that a
changing object identity discards the markdown streaming render cache.

`codeLabels` in the 0.1.0 declarations is `labels` in 0.1.7, and `JsonTreeLabels` is typed `Partial`
there but read in full here. The deployed component source, not the shipped `.d.ts`, is the authority
for this plugin; `test/client-bundle.test.mjs` encodes these three contracts as throwing stubs, so an
incomplete label object fails the suite rather than the browser.

### An atom may be an exotic component

`MarkdownText` is exported as `memo(...)` in the shipped bundle, so it is an **object**, not a
function: a `typeof atom === 'function'` guard silently disables it and the markdown cell falls back to
its own source. `Button` is the same class of value as a `forwardRef`. `CodeBlock` and `JsonTree` are
plain functions, so the same guard passed for them — which is exactly why only markdown was affected.
Capability is therefore tested with `isRenderable()` (function, or an object carrying a `$$typeof`),
never with `typeof`.

### The primitives bag is what reaches the tree

`apply` assembles a `primitivesBag` and passes it down; a component reads `primitives.X`, not the
module. Anything a component needs must be **listed in that bag**: `Button` and `Pill` were added to
the module but not to the bag, so every new control silently took its fallback path. A test asserting
the control's real node type is what catches this — a control that renders *something* is not proof
that it rendered the intended component.

### The body owns no scrollport

`scrollportRef` is "report a **renderer-owned** scrollport". This body owns none: the preview owner's
own body element scrolls (`overflow: auto`) and is what the owner saves and restores `scrollTop` on.
Attaching the ref to this non-scrolling root hijacked that — restoration then read and wrote a
`scrollTop` that is always 0. If this body ever becomes the scroller, report it then, and only then.

`scrollportRef` and `useResource` are read from the slot's props, so a preview owner that does not
supply them simply degrades (no relative images) instead of failing.

### There is no navigation channel to a renderer

The slot's owner interface is exactly `addResource`, `setResources`, `resourceAddress`, `content`,
`wrap` and `scrollportRef`. There is no target, anchor or fragment prop, so "open this notebook at cell
N" — from a tool result, for instance — **cannot be implemented against this contract**. The preview
owner's own `navigation.params.line` drives its text-pages mode and is not passed down. What is
reachable is an outline and a find box inside the rendering, which is what this plugin offers instead.

### Why `addResource` is not used

`addResource(address)` and `setResources(addresses)` declare the extra resources a **tab store** should
read (the latter prepends the notebook itself), and the rendered body receives `useResource` for
metadata. This plugin does not use them: the relative references in a notebook are already served
through the same authenticated route the preview loads the notebook from, by rewriting them to
`api/file` URLs, and the body's prop list exposes no verified way to read another address's bytes.
Replacing a working path with a guessed one is the worse trade; the rewrite is covered by tests.

### The suite replays state

A stateless expansion can only assert the first render, which left every click-driven behaviour —
expanding a long output, revealing a collapsed one, switching to the raw view, showing the cells
beyond the cap — verified only by hand. `test/client-bundle.test.mjs` therefore renders through a
minimal stateful reconciler: one hook store per component instance, keyed by position and key, so
`interactive(component, props).clickLabel('Show all')` runs the handler and re-renders through the same
store. It also runs **effects** after each render (re-rendering while they keep changing state) and
populates **refs**, both the callback form and the `{ current }` object `useRef` returns — which is what
makes a theme read or a frame measurement assertable from here. Four details that matter: a component
instance resets its hook cursor **once** per render (doing it per hook makes every hook read slot 0);
`useMemo` compares dependencies, so a memoized identity survives a re-render; the effect loop is
bounded, so an effect that sets state unconditionally cannot hang the suite; and the window is
browser-shaped (`innerHeight` included), because a missing viewport makes the image sizing refuse to
promise a zoom control.

What this still cannot check: anything that needs a real browser — the real clipboard, the real
`MarkdownText`/`CodeBlock`/`JsonTree` rendering, CSS stickiness, and the product's own visuals.

## Troubleshooting

**The tool card's UI is replaced by the product's generic row.** A render error does more than blank
our component: the slot core calls `reportEntryError(..., { abdicate: true })`, which retires the
entry from its cell for the rest of that registration's life while a generic row takes over. Confirm
it with `cordis_inspect_query` on client `Slots` with `{"root":"tool.call.toolview"}` — an abdicated
entry still appears in `occupants`, with `"active": false`. The preview body is visible the same way
under `{"root":"sidebar.right.tab.document"}`.

`active: false` is therefore the one signal worth checking after changing `src/client-ui.js`. Both
registered components sit behind an error boundary (`Guard`), so a future crash renders its message
and stack *inside* the card instead of silently abdicating; the console also logs it.

**The preview never appears for `.ipynb`.** Check that `jupyter-notebook` is in the
`sidebar.right.tab.document` occupants. If it is missing while the tool card did register, this
plugin activated before the document-preview package provided its service.

That was a real defect here. The preview registration used a one-shot
`ctx.get('documentPreviews')`, which returns `undefined` during a **cold start** — the preview
package has not activated yet — and then silently skipped the whole registration with only a console
warning. It went unnoticed because the plugin was first loaded *hot*, into a running tree where the
preview already existed; the hot path was mistaken for the cold one. The fix is Cordis's waiting
contract:

```js
ctx.inject(['documentPreviews'], (scoped) => { /* register the renderer and its body */ })
```

The callback runs once the service is available and is unloaded and re-run whenever it changes. The
tool card registers outside that scope, so a deployment with no document preview keeps the card.
`test/client-bundle.test.mjs` models the cold-start ordering (`deferInject`), which is what pins it.

**A changed bundle has no effect.** `lib/client.js` is served from the enabled Loader entry, and HMR
picks up a new revision only while a `dsh` source checkout runs `pnpm run dev:web`. Otherwise refresh
the page; a row or Node-half change needs a Harness restart.

## Limits

| What | Value | Where |
|---|---|---|
| Cells in a digest | 200 | `LIMITS.cardMaxCells` |
| Characters in a digest | 32768 | `LIMITS.cardMaxChars` |
| Image embedded in a digest | 64 KiB (larger ones keep their byte size only) | `LIMITS.cardEmbedImageMaxBytes` |
| Cells the preview draws at once | 300 (then **Show all cells**) | `LIMITS.previewMaxCells` |
| HTML output rendered in a frame | 512 KiB (larger renders as text) | `LIMITS.previewMaxHtmlChars` |
| HTML frame height | measured from content, clamped to 70% of the viewport (120 px before the first load) | `HTML_FRAME_MIN` / `HTML_FRAME_DEFAULT` / `HTML_FRAME_MAX_VIEWPORT` |
| Image output height | at most 70vh, and never enlarged past its intrinsic size | `S.image` |
| Notebook file size the tool reads | 32 MiB | `lib/index.js` |

`read_notebook` takes `file_path`, `cells` (`"1-5,8"`), `include_outputs`, and `max_chars`.

### Rendering notes

**Every color comes from the theme.** The styles read `--dsw-alias-*` variables rather than a
hard-coded palette, so the preview follows the app's light and dark themes. The theme publishes state
colors as *foregrounds* only, so a state surface (the error block) is derived with `color-mix`.

**An HTML output is measured, not guessed.** The frame is `sandbox="allow-same-origin"`: scripts stay
disabled, so its content cannot execute, reach this page, or read anything of this origin — but the
parent can read the framed document, which is the only way to size the frame to its content. A fixed
height is what turned a two-row DataFrame into a mostly empty white slab, so the frame measures
`scrollHeight` on load and clamps to 70% of the viewport; the expand control appears **only** when the
measurement reports clamped content.

Sanitizing that markup and rendering it inline was the alternative and was rejected: a hand-rolled
sanitizer standing between untrusted notebook output and this origin is a worse risk than an inert
frame. CSS variables do not cross the frame boundary either, so the page's colors are read from the
output's own element (walking up for the first painted background, since the theme may declare its
variables on `:root`, `body`, or a wrapper) and inlined into the frame's markup.

**Every table reads as a data table.** The frame's sheet gives a static table row separators, a bold
header with a stronger underline, zebra rows and a bold index column — no full grid, which is what
made a rendered DataFrame look like raw markup. One style covers both a pandas `to_html()` table and a
hand-written `<table>`: pandas sets `border="1"`, but that is only a presentational hint, so these
author rules win and the grid disappears. The separators and zebra tint are derived from the resolved
foreground with `color-mix`, so they follow the theme in both modes without depending on a token
value being visible here.

The fixture therefore carries a **real `to_html()` table**, not a hand-written two-cell one: the first
version of the fixture could not show this style at all, which is why "the table did not change" was
invisible from here.

An output whose markup is a table also **drops the container's own frame** (`S.frameBare`): the frame
exists to delimit an output widget, and a second box around a table that already draws its own
separators reads as a leftover. Every other HTML output keeps the framed card, so outputs stay
visually consistent.

**A cell is a two-column grid**, with the Jupyter prompt (`In [n]`) in a fixed gutter and the content
in a `minmax(0, 1fr)` track. The `minmax(0, …)` matters: a bare `1fr` lets one long code line stretch
the track past the pane.

**A collapsed output opens collapsed.** Jupyter writes `metadata.collapsed` when a user collapses an
output, so a reopened notebook does not flood the page with it: the cell shows the code and a
**Show output** control instead. `metadata.scrolled` is a different flag — it means the output area was
saved height-limited, so those outputs open capped even when they are short.

**A cell reports how long it ran, and keeps its prompt in view.** `metadata.execution` records the run's
timestamps, so the gutter shows the duration under the prompt (`412 ms`, `1.5 s`, `1 m 31 s`) with a
tooltip naming it; the chat card gets the same number through the digest's `ms`. The prompt column is
`position: sticky` within its own grid row, so a long cell keeps its `In [n]` visible while scrolling.

**Either half of a cell can be collapsed by the reader.** `metadata.collapsed` and
`metadata.jupyter.source_hidden` only set the *initial* state; the controls work regardless, and hiding
markdown hides the rendered prose (there is no separate output to leave behind).

**Nothing silently degrades.** Every place this plugin could quietly do nothing says so instead: a copy
control is **absent** when no clipboard writer exists rather than dead, a relative figure with no
absolute path to join is named in the pane, a missing atom is named in its cell, and the **Self-check**
panel states what the deployment actually provides — the running build id (a hash of `src/`, so a stale
tab is identifiable rather than guessed at), which components resolved, whether the clipboard and the
theme variables work, whether the file's absolute path was obtained, how many cells are shown, and the
viewport size.

**Work is not done twice.** A capped output renders only the lines the cap shows; the rest arrives when
the reader expands it. Capping the height alone still builds every line — a 5000-line log put 5000 lines
in the DOM. Images carry `loading="lazy"` and `decoding="async"`, like the frame already did.

**The outline prefers a heading.** A markdown cell's first `#` heading says more than its first line of
prose, so the outline uses it when there is one.

**Long notebooks are navigable, and there is a way out of the rendering.** A collapsible **contents
rail** sits to the left of the notebook — sticky in both states, so it stays put while the notebook
scrolls past it. A table of contents that scrolls away has to be scrolled back to before it can be used,
which is most of its value gone; collapsed, the rail is a narrow strip that still carries its own
toggle, for the same reason.

**Headings are the spine of that list.** A cell nests one level under the heading that precedes it
(`level` = that heading's level + 1), so a notebook with twenty code cells and three headings reads as
three sections rather than twenty-three flat lines; before any heading, cells sit at the top level. Code
entries are also **hidden by default** whenever the notebook has headings — a long list of code lines is
exactly what makes a contents list unusable — with one click to show them. A notebook with no headings
at all keeps its cells either way, and prose cells stand in as entries, because an outline of nothing
helps nobody. Clicking an entry scrolls that cell into view through a ref map rather than DOM ids, so
two panes showing the same notebook cannot collide, and the entry for the section the reader is looking
at is marked while they scroll.

The first version of this was a `<select>` flat in the meta bar and it hid the structure: one line per
cell, no depth, nothing readable at a glance, and it left the pane entirely when a reader scrolled. The
rail's items are deliberately **not** the product's `Button` — a control's padding per heading would
double the list's height.

The meta bar carries a **find** box that marks every matching cell, highlights the matching text inside
outputs (ANSI runs keep their colors), and steps through them with wraparound, plus a **View raw JSON**
control that shows the file exactly as saved — no re-serialization, since a re-encode would hide the
file's own formatting and anything the parser dropped. The raw view is capped by `previewRawChars` and
says so when it caps. A table output additionally offers its rows as **TSV** on the clipboard, which is
the form a reader most often needs them in.

**Tags and Jupyter's hiding flags are honoured.** A cell's `metadata.tags` render as the product's own
`Pill` chips — tags are how a toolchain records what a cell is for (papermill's `parameters`, nbval's
`raises-exception`, nbconvert's `remove_cell`), so dropping them hides information the notebook carries
on purpose. `metadata.jupyter.source_hidden` / `outputs_hidden` hide that part and leave a one-line
note saying so, rather than an empty-looking cell. Only the `jupyter` namespace is read: a same-named
top-level key is not what Jupyter writes.

**Outputs can be copied.** A text-shaped output carries a copy control that hands the text to the
product's own `writeClipboard`, so captured stdout, a traceback or a markdown cell's source can be
taken out without selecting text by hand. The controls are the product's `Button` (a `forwardRef`,
i.e. an object rather than a function — the `isRenderable` case again) with a native fallback.

**Rich output is rendered as what it is.** `text/markdown` goes through the markdown atom, and
`text/latex` is typeset as math — showing either as source was worse than the `text/plain` fallback it
outranked in the MIME order.

**Captured output keeps its colors, and its progress bars collapse.** ANSI SGR runs are rendered as
styled spans (`parseAnsiSpans`) instead of being flattened, and each line is reduced to its final
`\r` segment (`collapseCarriageReturns`) so a tqdm bar shows its last frame rather than every frame
mashed together. Two deliberate asymmetries: the digest that reaches the model **and the chat card**
stays escape-free (the digest carries the stripped text only, so the session log does not grow), and a
traceback is left escape-free as well — its block already carries the error styling. The SGR palette is
the one place a color literal is legitimate, because a terminal's colors are a standard rather than
theme tokens; black and white map to `currentColor` so the ends of the palette follow the theme.

**Images are never stretched, and the zoom control is honest.** A flex-column parent stretches its
items, so an image output sets `alignSelf: flex-start` and leaves `width`/`height` at `auto`. Without
that, a 1×1 pixel output renders as a full-width square. Fitting a wide figure to the pane shrinks
**everything inside it**, its labels included, so the scale is stated: when the load measurement finds
the image constrained (`imageIsConstrained`, against the pane width and the viewport cap), the output
shows the **percentage** it is being shown at and a control that toggles the actual size. A figure
smaller than the pane renders identically either way, so it shows neither — that control could not do
anything, which read as a broken feature.

The measurement reads the wrapper's width, falling back to the image's own rendered width, so it does
not silently do nothing when no wrapper has been attached yet.

**The fixture figure's font is proportional to its canvas.** The canvas is deliberately 1800×1000 so
the pane does constrain it, and the first version of the generator drew its labels with Pillow's
default bitmap face — a fixed ~11 px, which on a 3.75× larger canvas looked tiny and read as a plugin
defect. It now loads a TrueType face at a size derived from the canvas.

**The path helpers are transcribed, not required.** A relative markdown image needs the harness's
path rules and its authenticated `api/file` route, which live in `@deepseek-ai/dsh-util-workspace-path`.
That package **cannot be required from this bundle**: it is absent from the web shell's seeded module
table and is not a dynamic client row, so `require`ing it throws at materialization and takes the
entire client half down — no card, no preview, no error dialog. (The product's own preview bundle
mentions the package only in a JSDoc `@module` tag and inlines the code.) `src/notebook.js` therefore
carries a transcription of `isWindowsStylePath`, `isAbsoluteWorkspacePath`, `pathPartsOf`,
`fileMediaUrl`, and the preview owner's own markdown-image resolver. If the `api/file` route or those
path rules change upstream, this copy changes with them — and `test/notebook.test.mjs` states the
behaviour it assumes.

**A bundle may require only the seeded modules.** Today that is exactly `react` and
`@deepseek-ai/dsh-client-ui-primitives`. Adding any other `require` is the one change that can make
the whole client half disappear, so `test/client-bundle.test.mjs` asserts the request list rather than
trusting it.

## Security

`text/html` outputs are untrusted notebook content. They render in an `<iframe sandbox="allow-same-origin">`
— **scripts stay disabled**, so the framed markup cannot execute, navigate this page, or read anything
of this origin; the only grant is the parent's read access, which the frame measurement needs. SVG
renders through `<img>`, so its scripts never reach the page either. Path authorization belongs to
`ctx.fs`, exactly as it does for the built-in `read` tool.

## Known limitations

- **Relative images resolve in the preview, not in the chat card.** A markdown cell's
  `![](figs/a.png)` joins the notebook's own directory and is addressed through the authenticated
  `api/file` route — but that needs the document's Host absolute path, which only the preview body can
  read (`useResource(resourceAddress).value.absolutePath`). The tool card has no such path, so its
  relative images stay inert. **An `attachment:` image is the exception**: the notebook embeds it in
  the cell, so it renders in the card too with no Host path at all.
- **A relative `src`/`href`/`srcset` inside an HTML output is rewritten, not resolved by the frame.** A
  `srcDoc` document would resolve those against the host page and 404; each addressable relative
  reference is therefore joined to the notebook's directory and pointed at the file route, while a
  scheme, a `data:` URL or an unaddressable path keeps its authored value. A `srcset` candidate list
  keeps each descriptor, and `url()` is rewritten **only inside a `style` attribute** — rewriting every
  occurrence would also hit one the output merely mentions in its text.
- **Widget outputs are placeholders.** `application/vnd.jupyter.widget-view+json` and other
  unranked MIME types show a one-line note naming the type.
- **The chat card shows small images only.** Images above the digest budget render as
  "Image output (12.3 KiB); open the preview tab to view it".
- **An HTML output is inert by design.** Scripts inside it never run, so an output that depends on
  them (an interactive widget rendered as HTML) shows only its static markup.
- **A traceback keeps its frame colors.** Jupyter colors traceback frames, so the raw traceback is
  kept alongside the plain text and rendered as styled runs, like a stream's.
- **An `nbformat` 3 notebook is up-converted, not refused.** It still opens in Jupyter, so refusing it
  would hide a readable file behind a message. Cells are flattened out of their worksheets, a code
  cell's `input` becomes its source, `prompt_number` becomes `execution_count`, `pyout` becomes an
  `execute_result`, `pyerr` an `error`, and `heading` cells become markdown headings. A v3 file with no
  cells to convert is still refused, with a readable reason. Versions newer than 4 are read as 4.
- **A nested table is not expanded.** `tableToTsv` converts only the first table, does not expand
  `colspan`/`rowspan`, drops a nested table's content, and turns a cell's internal line breaks into
  spaces — TSV has no way to carry them.

### Not done, and why

- **No pane-level keyboard shortcuts.** `/` to focus find, `n`/`p` to step cells and the like need focus
  management inside someone else's pane, and a shortcut that swallows the product's own keys is worse
  than no shortcut. Find has keyboard support inside its own input instead.
- **No Config schema.** Whether the product surfaces a plugin's settings in its UI is unverified, so
  offering options that may be unreachable would be a promise this plugin cannot keep. The renderer's
  own controls (raw JSON, fold, find) cover the same needs.
- **Complex `text/latex`** is handed to the markdown atom inside `$$`: equation environments are the
  atom's business, not this plugin's.
- **No automatic reload on an external edit.** The preview owner reloads when the file's version
  changes, which is its business; this plugin has not verified the behaviour and does not claim it.
- **Widget outputs stay placeholders.** Rendering them means running scripts and talking to a kernel,
  which is exactly what the script-free frame exists to avoid.

## Manual verification

`test/fixtures/assets.ipynb` exists for the features that cannot be judged from the source: an
`attachment:` image, a relative markdown image, an HTML output referencing a relative file, a
carriage-return progress bar, ANSI-colored output, a `text/markdown` output, a collapsed output, cell
tags and a Jupyter-hidden output. It is generated by `test/fixtures/make-assets-notebook.mjs`, and the
suite asserts that it still carries all nine, so the fixture cannot silently stop exercising one of
them. `test/fixtures/nbformat3.ipynb` is a real nbformat 3 notebook, for the up-conversion path.
`test/fixtures/sample.ipynb`'s code cells carry run times (300 ms, 1.2 s, 2.8 s, 12.4 s, 640 ms, 95 ms),
stamped by `test/fixtures/add-execution-times.mjs` — the duration feature was invisible until the
fixture a reader is most likely to open carried the timestamps at all, and the suite now asserts that
each of those six values reaches the rendered tree.

### What the suite can and cannot prove

The suite loads the built bundle the way the web shell does and renders through a stateful
reconciler, so it proves: the module materializes with only the seeded requires, components register,
the tree carries the intended atoms and props, and every click-, key-, effect- and state-driven
behaviour does what it claims — the theme read (with a stubbed `getComputedStyle`) and the frame's own
load measurement included. It **cannot** prove anything that needs a browser:

| Only a browser can confirm | What correct looks like |
| --- | --- |
| The real clipboard | Copy writes the text, and the label flashes "Copied" |
| The real `MarkdownText` / `CodeBlock` / `JsonTree` | Markdown renders as markdown; code is highlighted; a JSON tree expands |
| The product's `Button` and `Pill` visuals | Controls sit correctly in the meta bar and cell grid, and read on both themes |
| CSS stickiness | A long cell keeps its `In [n]` prompt in view while scrolling |
| How the theme's own token values read | The tests pin which value is used where; whether a given grey is legible is the theme's business |
| Scroll position restoration | Switching tabs and back returns to the same place (the owner does this; this plugin must not hijack `scrollportRef`) |

Everything else — the parser, every projection, every control — is covered by `node scripts/run-tests.mjs`.

## Development

**Every feature ships with the data that shows it and an assertion that it appears.** Three failures in
this plugin's history had the same shape and none of them was a logic error: markdown never rendered (a
`typeof` guard on a `memo` component), a figure's labels looked tiny (the fixture drew them with a
fixed ~11 px bitmap face on a much larger canvas), and the run time was invisible (the only timestamps
lived in the fixture nobody had open). A feature that cannot be seen is not delivered, so a change
lands with a fixture that triggers it and a test asserting it reaches the rendered tree — including the
gutter durations in `sample.ipynb`, the nine features in `assets.ipynb`, and the build id in the
self-check panel.

```bash
node scripts/run-tests.mjs        # all suites, in this process
node scripts/build-client.mjs     # regenerate lib/client.js
node scripts/build-client.mjs --check
node --check lib/client.js
```

`lib/client.js` is generated: edit `src/notebook.js` or `src/client-ui.js` and rebuild. `--check`
fails when the artifact is stale, and it is worth running before any commit that touches `src/`.

`scripts/run-tests.mjs` exists because `node --test` spawns one child per file with piped stdio,
which the DSH file sandbox denies with `EPERM`; importing the suites directly runs the same
`node:test` suites in-process.

`src/notebook.js` is the single source of truth for both halves — the Node tool imports it, and
`scripts/build-client.mjs` splices it into the browser bundle, so the preview and the card cannot
parse a notebook differently.

## Design notes

Rejected alternatives, recorded so they are not re-litigated:

1. **A `sidebarRightTabs` type of our own** (`patterns: ['*.ipynb']`). It would have duplicated
   bounded reads, version watching, automatic refresh, the path header, and the renderer dropdown
   that the document preview already owns.
2. **Overriding the `read` card** by registering `tool.call.toolview` with key `read`. That key is
   shared by every read in the product; replacing it to special-case one extension trades a local
   fix for a global regression.
3. **Having the card fetch the notebook itself** over `remote.workspaceFiles`. It needs another
   client injection and a loading/failure state, and it re-reads on every replay; durable
   `presentationMeta` is the product's own client-derived-presentation channel.
4. **`binaryExtensions: ['ipynb']`** to hide the plain-text renderer. Notebook files *are* UTF-8
   text, so that flag would be a lie, and it would remove the escape hatch. The `extension` priority
   band already makes the notebook renderer the default.
5. **A system-prompt section** telling the model to prefer `read_notebook`. The tool description
   already carries that guidance, and a prompt section would tax every session that never touches a
   notebook.
