/**
 * Browser half of `dsh-jupyter`.
 *
 * This file is a *fragment*: `scripts/build-client.mjs` splices it, together
 * with `src/notebook.js`, into the served ModuleLoader bundle. It therefore
 * must not use `import`, JSX, or TypeScript, and it may only reach `React` and
 * `primitives` (both seeded statically by the web shell) plus whatever
 * `src/notebook.js` declared above it.
 *
 * Two registrations:
 *  - a `documentPreviews` implementation that makes `.ipynb` open as a rendered
 *    notebook in the right Sidebar's document tab, and
 *  - a `tool.call.toolview` card for the `read_notebook` tool.
 *
 * Both share one cell renderer so the preview and the chat card cannot drift.
 */

/* eslint-disable no-undef -- React and require arrive from the bundle wrapper. */

const PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives')

const PREVIEW_ID = 'jupyter-notebook'
const CARD_TOOL_KEY = 'read_notebook'
const LOCALE_NS = 'dshJupyter'

const ZH = {
  'viewer.label': 'Jupyter Notebook',
  'preview.cells': '个单元格',
  'preview.executed': '个已执行',
  'preview.kernel': '内核',
  'preview.showAll': '显示全部单元格',
  'preview.outline': '目录',
  'preview.showOutline': '目录',
  'preview.hideOutline': '收起目录',
  'preview.noOutline': '没有可导航的标题或单元格',
  'preview.showCodeCells': '显示代码格',
  'preview.hideCodeCells': '隐藏代码格',
  'preview.showRaw': '查看原始 JSON',
  'preview.showRendered': '返回渲染视图',
  'preview.find': '在 notebook 中查找',
  'preview.noMatches': '无匹配',
  'preview.previous': '上一个',
  'preview.next': '下一个',
  'preview.selfCheck': '自检',
  'preview.selfCheckTitle': '当前部署的实际能力',
  'self.build': '构建',
  'self.atoms': '可用组件',
  'self.clipboard': '剪贴板',
  'self.themeTokens': '主题变量',
  'self.hostPath': '文件绝对路径',
  'self.cells': '单元格',
  'self.viewport': '视口',
  'self.available': '可用',
  'self.unavailable': '不可用',
  'self.resolved': '可解析',
  'self.derived': '不可解析（颜色为派生值）',
  'self.present': '已获取',
  'self.absent': '未获取',
  'self.unknown': '未知',
  'preview.truncated': '已隐藏部分单元格或输出',
  'preview.incomplete': '显示尚未加载完的 notebook 内容',
  'summary.cells': '{n} 个单元格',
  'summary.code': '{n} 段代码',
  'summary.executed': '{n} 个已执行',
  'summary.truncated': '已截断',
  'error.title': '无法渲染该 notebook',
  'atom.missing': '当前部署未提供 {name}，已降级为纯文本显示',
  'cell.in': 'In',
  'cell.raw': '原始',
  'cell.duration': '该单元格的执行耗时',
  'code.copy': '复制',
  'code.copied': '已复制',
  'code.label': '代码',
  'code.wrap': '自动换行',
  'code.unwrap': '取消换行',
  'markdown.footnotes': '脚注',
  'json.copyValue': '复制值',
  'json.copyJson': '复制 JSON',
  'json.copyPath': '复制路径',
  'json.copyPrettyJson': '复制为格式化 JSON',
  'json.copyCompactJson': '复制为紧凑 JSON',
  'json.copyFailed': '复制失败',
  'json.collapseNode': '折叠节点',
  'json.expandNode': '展开节点',
  'json.copyButtonTitle': '复制：{action}',
  'render.failed': 'dsh-jupyter 渲染失败',
  'output.stdout': 'stdout',
  'output.stderr': 'stderr',
  'output.html': 'HTML 输出',
  'output.htmlTooLarge': 'HTML 输出过大，已按文本显示',
  'output.htmlExpand': '展开全部',
  'output.htmlCollapse': '收起',
  'output.expandLines': '展开全部 {n} 行',
  'output.collapse': '收起',
  'output.imageActual': '查看实际大小',
  'output.imageFit': '适应宽度',
  'output.image': '图像输出',
  'copy.text': '复制',
  'copy.copied': '已复制',
  'output.sourceHidden': '输入已隐藏（notebook 元数据）',
  'output.outputsHidden': '输出已隐藏（notebook 元数据）',
  'output.showOutputs': '显示输出',
  'output.hideOutputs': '隐藏输出',
  'output.hideSource': '隐藏输入',
  'output.showSource': '显示输入',
  'preview.relativeImages': '这些相对图片无法显示（没有取到文件的绝对路径）：{list}',
  'output.imageOmitted': '图片输出（{size}），请在预览标签页中查看',
  'output.unsupported': '暂不渲染的输出类型：{note}',
  'card.open': '在预览中打开',
  'card.file': '文件',
  'card.noPath': '未提供文件路径',
  'card.running': '正在读取 notebook…',
  'card.digestMissing': '内核返回了结果，但没有可渲染的 notebook 数据'
}

const EN = {
  'viewer.label': 'Jupyter Notebook',
  'preview.cells': 'cells',
  'preview.executed': 'executed',
  'preview.kernel': 'kernel',
  'preview.showAll': 'Show all cells',
  'preview.outline': 'Contents',
  'preview.showOutline': 'Contents',
  'preview.hideOutline': 'Hide contents',
  'preview.noOutline': 'Nothing to navigate',
  'preview.showCodeCells': 'Show code cells',
  'preview.hideCodeCells': 'Hide code cells',
  'preview.showRaw': 'View raw JSON',
  'preview.showRendered': 'Back to rendered',
  'preview.find': 'Find in notebook',
  'preview.noMatches': 'no matches',
  'preview.previous': 'Previous',
  'preview.next': 'Next',
  'preview.selfCheck': 'Self-check',
  'preview.selfCheckTitle': 'What this deployment actually provides',
  'self.build': 'build',
  'self.atoms': 'components',
  'self.clipboard': 'clipboard',
  'self.themeTokens': 'theme tokens',
  'self.hostPath': 'file path',
  'self.cells': 'cells',
  'self.viewport': 'viewport',
  'self.available': 'available',
  'self.unavailable': 'unavailable',
  'self.resolved': 'resolve',
  'self.derived': 'do not resolve (colors are derived)',
  'self.present': 'resolved',
  'self.absent': 'not resolved',
  'self.unknown': 'unknown',
  'preview.truncated': 'Some cells or outputs were hidden',
  'preview.incomplete': 'Showing notebook content before it loaded completely',
  'summary.cells': '{n} cells',
  'summary.code': '{n} code',
  'summary.executed': '{n} executed',
  'summary.truncated': 'truncated',
  'error.title': 'This notebook could not be rendered',
  'atom.missing': 'This deployment does not expose {name}; showing plain text instead',
  'cell.in': 'In',
  'cell.raw': 'Raw',
  'cell.duration': 'This cell’s run time',
  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'code.label': 'Code',
  'code.wrap': 'Wrap lines',
  'code.unwrap': 'Unwrap lines',
  'markdown.footnotes': 'Footnotes',
  'json.copyValue': 'Copy value',
  'json.copyJson': 'Copy JSON',
  'json.copyPath': 'Copy path',
  'json.copyPrettyJson': 'Copy as pretty JSON',
  'json.copyCompactJson': 'Copy as compact JSON',
  'json.copyFailed': 'Copy failed',
  'json.collapseNode': 'Collapse node',
  'json.expandNode': 'Expand node',
  'json.copyButtonTitle': 'Copy: {action}',
  'render.failed': 'dsh-jupyter render failed',
  'output.stdout': 'stdout',
  'output.stderr': 'stderr',
  'output.html': 'HTML output',
  'output.htmlTooLarge': 'HTML output was too large; showing it as text',
  'output.htmlExpand': 'Show more',
  'output.htmlCollapse': 'Show less',
  'output.expandLines': 'Show all {n} lines',
  'output.collapse': 'Collapse',
  'output.imageActual': 'View actual size',
  'output.imageFit': 'Fit width',
  'output.image': 'Image output',
  'copy.text': 'Copy',
  'copy.copied': 'Copied',
  'output.sourceHidden': 'Input hidden by notebook metadata',
  'output.outputsHidden': 'Output hidden by notebook metadata',
  'output.showOutputs': 'Show output',
  'output.hideOutputs': 'Hide output',
  'output.hideSource': 'Hide input',
  'output.showSource': 'Show input',
  'preview.relativeImages': 'These relative images cannot be shown (no absolute path for the file): {list}',
  'output.imageOmitted': 'Image output ({size}); open the preview tab to view it',
  'output.unsupported': 'Output type not rendered yet: {note}',
  'card.open': 'Open in preview',
  'card.file': 'File',
  'card.noPath': 'No file path was provided',
  'card.running': 'Reading the notebook…',
  'card.digestMissing': 'The tool settled without renderable notebook data'
}

/** Theme-agnostic inline styles over the product's own theme variables. */
const T = {
  bgBase: 'var(--dsw-alias-bg-base)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  border1: 'var(--dsw-alias-border-l1)',
  border2: 'var(--dsw-alias-border-l2)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  brand: 'var(--dsw-alias-brand-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  idle: 'var(--dsw-alias-state-idle-primary)'
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * A translucent tint of a state color. The theme publishes state colors as
 * foregrounds only, so a state *surface* has to be derived; an engine without
 * `color-mix` drops the declaration and keeps the neutral surface underneath.
 */
const tint = (color, percent) => `color-mix(in srgb, ${color} ${percent}%, transparent)`

/**
 * A stylesheet scoped to this plugin's own subtree.
 *
 * The atoms draw themselves and take no surface props, so the only levers are the
 * stable hooks they expose: the `md-code-block` marker class and its
 * `data-code-block-banner` attribute. Every selector is prefixed with this
 * plugin's own class, so nothing outside a notebook pane is touched — and the
 * selectors outrank the atoms' single hashed class, so no `!important` is needed.
 *
 * The surface is **derived from the resolved foreground** rather than read from a
 * theme variable. Two reasons: the `--dsw-*` variables are not reliably visible
 * from this subtree (a missed lookup once produced `currentColor` borders), and
 * the theme's "layer" surfaces sit very close to the page in light mode, which is
 * exactly what read as washed out. A tint of the foreground is a guaranteed,
 * theme-adaptive step away from the page in both modes; raise the percentage for
 * a heavier card.
 */
const CODE_SURFACE_TINT = 12
const SCOPED_CSS = [
  `.dsh-jupyter .md-code-block{background:color-mix(in srgb, currentColor ${CODE_SURFACE_TINT}%, transparent);`
    + `border:1px solid color-mix(in srgb, currentColor 15%, transparent)}`,
  '.dsh-jupyter .md-code-block [data-code-block-banner]{border-bottom:1px solid color-mix(in srgb, currentColor 15%, transparent)}'
].join('')

/** Frame sizing for an HTML output. The frame measures its own content on load. */
const HTML_FRAME_MIN = 40
const HTML_FRAME_DEFAULT = 120
const HTML_FRAME_MAX_VIEWPORT = 0.7

const S = {
  root: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '12px 14px 24px', fontSize: '13px', lineHeight: '1.55', color: T.labelPrimary },
  meta: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', color: T.labelSecondary, fontSize: '12px' },
  separator: { opacity: 0.5 },
  // One cell is a two-column grid: the Jupyter-style prompt gutter, then the
  // content column. `minmax(0, 1fr)` keeps one long code line or a wide output
  // from stretching the track past the pane.
  cell: { display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr)', columnGap: '10px', alignItems: 'start' },
  gutter: {
    // Sticky within its own grid row, so the prompt follows a long cell. `align-self`
    // must not stretch, or the sticky range collapses to the cell's full height.
    position: 'sticky',
    top: 0,
    alignSelf: 'start',
    textAlign: 'right',
    paddingTop: '3px',
    fontSize: '11px',
    lineHeight: '1.6',
    color: T.idle,
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
    whiteSpace: 'nowrap'
  },
  /** The recorded run time, under the prompt. */
  duration: { fontSize: '10px', color: T.labelSecondary, fontVariantNumeric: 'tabular-nums' },
  body: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  out: { margin: 0, padding: '6px 8px', borderRadius: '6px', background: T.bgLayer1, border: `1px solid ${T.border1}`, overflowX: 'auto', whiteSpace: 'pre', fontFamily: MONO, fontSize: '12px' },
  err: { margin: 0, padding: '6px 8px', borderRadius: '6px', background: tint(T.error, 10), border: `1px solid ${tint(T.error, 45)}`, color: T.error, overflowX: 'auto', whiteSpace: 'pre', fontFamily: MONO, fontSize: '12px' },
  htmlWrap: { display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' },
  outputWrap: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  imageWrap: { alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', maxWidth: '100%', overflowX: 'auto' },
  frame: { display: 'block', width: '100%', border: `1px solid ${T.border1}`, borderRadius: '6px', background: T.bgLayer1 },
  // A table output is content, not a widget: the container's border and surface
  // are dropped so a DataFrame reads as a data table rather than a boxed block.
  frameBare: { border: 'none', background: 'transparent' },
  // No width without `alignSelf`: a flex-column parent stretches its items, which
  // turned a 1x1 image output into a full-width square.
  image: { display: 'block', alignSelf: 'flex-start', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '6px' },
  quiet: { margin: 0, color: T.labelSecondary, fontSize: '12px', fontStyle: 'italic' },
  error: { padding: '10px 12px', borderRadius: '6px', border: `1px solid ${tint(T.error, 45)}`, background: tint(T.error, 8) },
  errorTitle: { fontWeight: 600, marginBottom: '4px', color: T.error },
  button: { border: `1px solid ${T.border2}`, borderRadius: '6px', background: T.bgLayer2, color: T.labelPrimary, padding: '3px 10px', fontSize: '12px', cursor: 'pointer' },
  linkButton: { alignSelf: 'flex-start', border: 'none', background: 'transparent', color: T.brand, padding: 0, fontSize: '12px', cursor: 'pointer' },
  /** The controls under an output: copy on the left, expand after it. */
  outputTools: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '2px' },
  /** A cell's tag chips, above its body. */
  tagRow: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' },
  /** A search hit, and the hit a reader is currently on. */
  cellMatch: { borderLeft: `2px solid ${T.border2}`, paddingLeft: '6px', marginLeft: '-8px' },
  cellActiveMatch: { borderLeft: `2px solid ${T.brand}`, paddingLeft: '6px', marginLeft: '-8px', background: T.bgLayer1 },
  /** The in-pane find controls. */
  findInput: {
    width: '140px',
    border: `1px solid ${T.border1}`,
    borderRadius: '4px',
    background: 'transparent',
    color: T.labelPrimary,
    font: 'inherit',
    fontSize: '12px',
    padding: '1px 6px'
  },
  matchCount: { color: T.labelSecondary, fontSize: '12px', fontVariantNumeric: 'tabular-nums' },
  /** A find hit inside an output's own text. */
  matchMark: { background: tint(T.brand, 0.28), borderRadius: '2px', color: 'inherit' },
  /** The self-check panel: what this deployment provides. */
  selfCheck: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 10px',
    border: `1px solid ${T.border1}`,
    borderRadius: '6px',
    background: T.bgLayer1,
    fontSize: '12px'
  },
  metaTitle: { fontWeight: 600, marginBottom: '2px' },
  selfRow: { display: 'flex', gap: '8px' },
  selfLabel: { minWidth: '132px', color: T.labelSecondary },
  /** The contents rail and the notebook, side by side. */
  workspace: { display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 },
  // The rail is sticky within the workspace, so it stays put while the notebook
  // scrolls past it; `align-self` must not stretch or its sticky range collapses.
  rail: {
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
    flex: '0 0 auto',
    width: '190px',
    maxHeight: 'calc(100vh - 140px)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  // Collapsed, the rail is just its toggle — narrow, and still sticky so it can be
  // reopened without scrolling back to the top.
  railCollapsed: { position: 'sticky', top: 0, alignSelf: 'flex-start', flex: '0 0 auto' },
  // `minWidth: 0` for the same reason the cell grid needs it: a bare flex item lets
  // one long code line stretch the row past the pane.
  workspaceBody: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' },
  /** The collapsible contents list. */
  outlinePanel: {
    display: 'flex',
    flexDirection: 'column',
    padding: '4px',
    border: `1px solid ${T.border1}`,
    borderRadius: '6px',
    background: T.bgLayer1
  },
  // A dense list, so these are not the product's `Button`: a control with a control's
  // padding per heading would double the list's height.
  outlineItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '2px 6px',
    border: 'none',
    background: 'transparent',
    color: T.labelPrimary,
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '1.5',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: '4px'
  },
  outlineItemCurrent: { background: T.bgLayer2, color: T.labelPrimary, fontWeight: 600 },
  outlineHeading: { fontWeight: 600, color: T.labelPrimary },
  outlineToggle: { display: 'flex', justifyContent: 'flex-end', padding: '0 2px 2px' },
  outlineCode: { color: T.labelSecondary, fontFamily: MONO, fontSize: '11px' },
  /** The raw notebook source, when a reader asks for it. */
  raw: {
    margin: 0,
    padding: '10px 12px',
    border: `1px solid ${T.border1}`,
    borderRadius: '6px',
    background: T.bgLayer1,
    color: T.labelPrimary,
    fontFamily: MONO,
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  tagFallback: {
    padding: '1px 8px',
    border: `1px solid ${T.border1}`,
    borderRadius: '999px',
    color: T.labelSecondary,
    fontSize: '11px'
  },
  card: { border: `1px solid ${T.border1}`, borderRadius: '8px', overflow: 'hidden', background: T.bgBase },
  cardHead: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderBottom: `1px solid ${T.border1}`, background: T.bgLayer2 },
  cardPath: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.labelPrimary },
  cardBody: { maxHeight: '420px', overflow: 'auto' }
}

/**
 * Render-error boundary around every component this plugin registers.
 *
 * A thrown render error does not merely blank our UI: the slot core retires the
 * entry from its cell (`reportEntryError(..., { abdicate: true })`), so the
 * product's generic row silently replaces it and the failure is visible only in
 * the browser console. Catching here keeps the registration alive and shows the
 * reason where the user can read it.
 */
class Guard extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[dsh-jupyter] render failed', error)
  }

  render() {
    const error = this.state.error
    if (error === null || error === undefined) return this.props.children
    const detail = error !== null && typeof error === 'object' && typeof error.stack === 'string' ? error.stack : String(error)
    return React.createElement(
      'div',
      { style: S.error },
      React.createElement('div', { style: S.errorTitle }, String(this.props.title)),
      React.createElement('pre', { style: S.err }, detail)
    )
  }
}

/**
 * A quiet, explicit note where a shared atom this deployment does not expose was
 * needed. Silently degrading to plain text is what made "the markdown did not
 * render" indistinguishable from "the markdown rendered as source".
 */
function MissingAtom({ name, labels }) {
  const h = React.createElement
  return h('p', { style: S.quiet }, labels('atom.missing').replace('{name}', name))
}

/**
 * Whether a value can be handed to `React.createElement` as an element type.
 *
 * `typeof value === 'function'` is **not** the test: `memo()` and `forwardRef()`
 * return objects, so a memoized atom reads as `'object'` and a `typeof` guard
 * silently disables it. `MarkdownText` is `memo(...)` in the shipped bundle, which
 * is exactly how markdown rendering stayed switched off here.
 * @param value - a candidate element type.
 * @returns whether it is renderable.
 */
function isRenderable(value) {
  if (typeof value === 'function') return true
  if (value === null || typeof value !== 'object') return false
  return typeof value.$$typeof === 'symbol'
}

/** Format a byte count for a placeholder line. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Build the `<img>` source for a normalized image output. */
function imageSource(output) {
  if (typeof output.base64 === 'string' && output.base64.length > 0) return imageDataUrl(output.mime, output.base64)
  if (typeof output.svg === 'string' && output.svg.length > 0) return imageDataUrl(output.mime, output.svg)
  return undefined
}

/**
 * Address the relative `src` / `href` values inside an HTML output.
 *
 * A `srcDoc` document resolves relative URLs against the host page, so a figure
 * named next to the notebook would 404. Only a destination the resolver can
 * address is rewritten — a scheme, a fragment or an unaddressable path keeps the
 * authored value. This rewrites attribute values and never parses the markup; the
 * frame is script-free, so there is no script text to mangle.
 * @param html - the output's own markup.
 * @param resolve - the notebook's image resolver, when it has one.
 * @returns the markup with addressable relative references rewritten.
 */
function rewriteRelativeAssets(html, resolve) {
  if (typeof resolve !== 'function') return html
  // `url()` is rewritten only inside a `style` attribute. Rewriting every `url(`
  // occurrence would also hit one the output merely mentions in its text.
  const withStyleUrls = html.replace(
    /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (match, prefix, _quoted, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted !== undefined ? doubleQuoted : singleQuoted
      let changed = false
      const rewritten = value.replace(
        /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]*))\s*\)/gi,
        (whole, single, double, bare) => {
          const target = single !== undefined ? single : double !== undefined ? double : bare
          const resolved = resolve(target)
          if (resolved === undefined) return whole
          changed = true
          return `url("${resolved.replace(/"/g, '&quot;')}")`
        }
      )
      return changed ? `${prefix}"${rewritten.replace(/"/g, '&quot;')}"` : match
    }
  )
  // `srcset` carries a comma-separated candidate list, each with a descriptor.
  const withSrcset = withStyleUrls.replace(
    /(\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (match, prefix, _quoted, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted !== undefined ? doubleQuoted : singleQuoted
      let changed = false
      const candidates = value.split(',').map((candidate) => {
        const trimmed = candidate.trim()
        const space = trimmed.search(/\s/)
        const url = space === -1 ? trimmed : trimmed.slice(0, space)
        const descriptor = space === -1 ? '' : trimmed.slice(space)
        const rewritten = resolve(url)
        if (rewritten === undefined) return trimmed
        changed = true
        return `${rewritten}${descriptor}`
      })
      return changed ? `${prefix}"${candidates.join(', ').replace(/"/g, '&quot;')}"` : match
    }
  )
  return withSrcset.replace(
    /(\s(?:src|href)\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (match, prefix, _quoted, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted !== undefined ? doubleQuoted : singleQuoted
      const rewritten = resolve(value)
      if (rewritten === undefined) return match
      return `${prefix}"${rewritten.replace(/"/g, '&quot;')}"`
    }
  )
}

/** One output block's line cap before it collapses behind a control. */
const COLLAPSE_LINES = 24
/** The components the self-check reports on, in the order it lists them. */
const ATOM_NAMES = ['MarkdownText', 'CodeBlock', 'JsonTree', 'Button', 'Pill']
const COLLAPSE_MAX_HEIGHT = '320px'
/** How long a "copied" confirmation stays on screen. */
const COPY_FLASH_MS = 1500

/**
 * The opaque background actually painted behind an element.
 *
 * The theme variables are inherited from wherever the theme declares them
 * (`:root`, `body`, or a wrapper), so reading a variable from `documentElement`
 * can come back empty and leave the frame's own default white. Walking up for the
 * first resolved, non-transparent `background-color` does not depend on knowing
 * where the theme put them.
 * @param element - the element to start from.
 * @returns a CSS color.
 */
function effectiveBackground(element) {
  let node = element
  while (node !== null && node !== undefined) {
    try {
      const color = getComputedStyle(node).backgroundColor
      if (color !== undefined && color !== '' && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
    } catch {
      return 'transparent'
    }
    node = node.parentElement
  }
  return 'transparent'
}

/**
 * Resolve the theme's *literal* colors for a sandboxed frame.
 *
 * A frame is a separate document, so `var(--dsw-*)` inside it resolves to
 * nothing: the values have to be read from this page and inlined into the frame's
 * own markup. They are read from the element the output is rendered into, so an
 * inherited variable resolves no matter where the theme declares it.
 * @param element - the element the output is rendered into.
 * @returns literal colors for the frame document.
 */
function frameTheme(element) {
  const fallback = {
    background: 'transparent',
    color: 'inherit',
    border: 'color-mix(in srgb, currentColor 25%, transparent)',
    surface: 'color-mix(in srgb, currentColor 6%, transparent)'
  }
  try {
    if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback
    if (element === null || element === undefined) return fallback
    const computed = getComputedStyle(element)
    const read = (name, or) => {
      const value = computed.getPropertyValue(name).trim()
      return value.length > 0 ? value : or
    }
    return {
      background: read('--dsw-alias-bg-base', effectiveBackground(element)),
      color: read('--dsw-alias-label-primary', computed.color !== '' ? computed.color : fallback.color),
      // The `--dsw-*` variables are not reliably visible from an output's own
      // element (a `currentColor` mix is what a missing variable produced: black
      // borders), so each color falls back to something derived from the resolved
      // foreground rather than to a literal.
      border: read('--dsw-alias-border-l1', fallback.border),
      surface: read('--dsw-alias-bg-layer-2', fallback.surface)
    }
  } catch {
    return fallback
  }
}

/**
 * Give an HTML output the page's colors and readable tabular typography, so a
 * DataFrame does not appear as a bare bordered grid on a white slab.
 * @param html - the output's own markup.
 * @param theme - literal colors from {@link frameTheme}.
 * @returns the document to hand to `srcDoc`.
 */
function frameDocument(html, theme) {
  // A missing value would emit `solid undefined` and drop the whole declaration,
  // so every interpolated color passes through here first.
  const color = (value, or) => (typeof value === 'string' && value.trim().length > 0 ? value : or)
  const background = color(theme.background, 'transparent')
  const foreground = color(theme.color, 'inherit')
  const border = color(theme.border, 'currentColor')
  const surface = color(theme.surface, 'transparent')
  const rowRule = '1px solid ' + border
  // A slightly stronger line under the header; derived from the resolved
  // foreground so it does not depend on a token being visible here.
  const headRule = '1px solid color-mix(in srgb, currentColor 40%, transparent)'
  const style =
    '<style>'
    + 'html,body{margin:0;padding:8px;background:' + background + ';color:' + foreground + ';'
    + "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.5}"
    // Every table reads as a data table: a bold header, row separators, zebra rows
    // and a bold index column — no full grid, which is what made it look like raw
    // markup. `border="1"` on a pandas table is a presentational hint, so these
    // author rules win and the grid disappears.
    + 'table{border-collapse:collapse;font-variant-numeric:tabular-nums;margin:0;max-width:100%}'
    + 'caption{text-align:left;color:' + foreground + ';opacity:.7;padding-bottom:4px}'
    + 'th,td{padding:6px 12px;text-align:left;vertical-align:top;border:0;border-bottom:' + rowRule + '}'
    + 'thead th{font-weight:600;border-bottom:' + headRule + '}'
    + 'tbody th{font-weight:600}'
    + 'tbody tr:nth-child(even) td,tbody tr:nth-child(even) th{background:' + surface + '}'
    + 'img{max-width:100%}a{color:inherit}hr{border-color:' + border + '}'
    + '</style>'
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, style + '</head>')
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, '<html$1>' + style)
  return style + html
}

/**
 * An HTML output in a script-free frame that measures itself.
 *
 * `sandbox="allow-same-origin"` is deliberate: the frame stays inert — without
 * `allow-scripts` its content cannot execute, so it can neither reach this page
 * nor read anything of this origin — while the parent gains read access to the
 * framed document, which is the only way to size the frame to its content. A
 * fixed height is what turned a two-row table into a mostly empty slab.
 *
 * Sanitizing the markup and rendering it inline was the alternative, and was
 * rejected: a hand-rolled sanitizer guarding untrusted notebook output is a worse
 * risk than an inert frame.
 */
function HtmlOutput({ output, wrap, labels, pathImages, primitives }) {
  const h = React.createElement
  const [expanded, setExpanded] = React.useState(false)
  const [measured, setMeasured] = React.useState(undefined)
  const [theme, setTheme] = React.useState(() => frameTheme(undefined))
  const wrapRef = React.useRef(null)
  const tooLarge = output.text.length > LIMITS.previewMaxHtmlChars
  // A figure named next to the notebook is what a `srcDoc` frame cannot reach.
  const html = rewriteRelativeAssets(output.text, pathImages === undefined ? undefined : pathImages.resolve)

  React.useEffect(() => {
    if (tooLarge) return
    setTheme(frameTheme(wrapRef.current))
  }, [tooLarge])

  const onLoad = (event) => {
    const frame = event !== null && event !== undefined ? event.currentTarget : undefined
    const document_ = frame !== null && frame !== undefined ? frame.contentDocument : undefined
    if (document_ === null || document_ === undefined) return
    const root = document_.documentElement
    const body = document_.body
    const content = Math.max(root !== null ? root.scrollHeight : 0, body !== null && body !== undefined ? body.scrollHeight : 0)
    if (!Number.isFinite(content) || content <= 0) return
    const viewport = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 800
    const cap = Math.max(HTML_FRAME_MIN, Math.round(viewport * HTML_FRAME_MAX_VIEWPORT))
    // The frame's own document scrolls to its content height; the extra pixels
    // absorb a fractional layout height and avoid a one-pixel scrollbar.
    const wanted = content + 2
    setMeasured({ content: wanted, height: Math.min(Math.max(wanted, HTML_FRAME_MIN), cap), clamped: wanted > cap })
  }

  if (tooLarge) {
    return h(
      'div',
      { style: S.body },
      h('p', { style: S.quiet }, labels('output.htmlTooLarge')),
      h('pre', { style: wrap ? { ...S.out, whiteSpace: 'pre-wrap' } : S.out }, output.text.slice(0, LIMITS.previewOutputChars))
    )
  }

  const height = measured === undefined ? HTML_FRAME_DEFAULT : expanded ? measured.content : measured.height
  const clamped = measured !== undefined && measured.clamped
  // A table is content, not a widget: the container's frame would put a second box
  // around a table that already draws its own separators.
  const isTable = /<table[\s>]/i.test(output.text)
  const tsv = isTable ? tableToTsv(output.text) : ''

  return h(
    'div',
    { ref: wrapRef, style: S.htmlWrap },
    h('iframe', {
      title: labels('output.html'),
      sandbox: 'allow-same-origin',
      srcDoc: frameDocument(html, theme),
      style: { ...S.frame, ...(isTable ? S.frameBare : null), height },
      loading: 'lazy',
      onLoad
    }),
    h(
      'div',
      { style: S.outputTools },
      // A rendered DataFrame is the output a reader most often wants to move
      // somewhere else, and selecting it out of a frame by hand is tedious.
      tsv.length === 0 ? null : h(CopyControl, { text: tsv, primitives, labels }),
      clamped
        ? h(
          Control,
          { primitives, onClick: () => setExpanded((value) => !value) },
          expanded ? labels('output.htmlCollapse') : labels('output.htmlExpand')
        )
        : null
    )
  )
}

/**
 * One error output. A traceback normally ends with the same `name: value` line
 * that heads it, so the head is only added when the traceback does not already
 * carry it — otherwise the exception is printed twice.
 */
function errorOutputText(output, text) {
  const head = `${output.name}: ${output.value}`
  const traceback = (text === undefined ? output.text : text).trim()
  if (traceback.length === 0) return head
  const lines = traceback.split('\n').filter((line) => line.trim().length > 0)
  const last = lines.length > 0 ? lines[lines.length - 1].trim() : ''
  return last === head ? traceback : `${head}\n\n${traceback}`
}

/**
 * A text-shaped output, collapsed behind a control once it passes the line cap.
 * A 2000-line traceback should not push the rest of the notebook off screen.
 * When the output carried ANSI escapes, its runs are rendered with the styles
 * they selected instead of being flattened to plain text.
 */
function TextOutput({ text, ansi, style, wrap, labels, primitives, title, forceCap, query }) {
  const h = React.createElement
  const [expanded, setExpanded] = React.useState(false)
  const lines = text.split('\n').length
  // `forceCap` is Jupyter's `metadata.scrolled`: the output was saved height-limited,
  // so it opens capped even when it is short.
  const capped = forceCap === true || lines > COLLAPSE_LINES
  const body = wrap ? { ...style, whiteSpace: 'pre-wrap' } : { ...style }
  if (capped && !expanded) {
    body.maxHeight = COLLAPSE_MAX_HEIGHT
    body.overflowY = 'hidden'
  }
  const colored = typeof ansi === 'string' && ansi.indexOf('\u001B') !== -1
  // A capped output renders only what the cap shows; the rest is put in the DOM when
  // the reader asks for it. Capping the height alone still builds every line.
  const shown = capped && !expanded
  const sliceLines = (value) => (shown ? value.split('\n').slice(0, COLLAPSE_LINES).join('\n') : value)
  const source = colored ? sliceLines(ansi) : sliceLines(text)
  // The find query is highlighted inside the runs, so an ANSI run keeps its own color
  // and a match inside it is still marked.
  const search = typeof query === 'string' ? query : ''
  const runs = colored
    ? parseAnsiSpans(source).flatMap((span) =>
      highlightRuns(span.text, search).map((run) => ({ ...run, style: run.match ? { ...span.style, ...S.matchMark } : span.style }))
    )
    : highlightRuns(source, search).map((run) => ({ ...run, style: run.match ? S.matchMark : undefined }))
  // With nothing to style the text stays one string: an array of one is equivalent to
  // render but a different shape for everything downstream.
  const styled = colored || runs.some((run) => run.match)
  const content = styled
    ? runs.map((run, at) =>
      run.style === undefined
        ? run.text
        : h('span', { key: `run-${at}`, style: run.style, 'data-match': run.match ? 'true' : undefined }, run.text)
    )
    : source
  return h(
    'div',
    { style: S.outputWrap },
    h('pre', { style: body, title }, content),
    h('div', { style: S.outputTools },
      h(CopyControl, { text, primitives, labels }),
      capped
        ? h(Control, { primitives, onClick: () => setExpanded((value) => !value) },
          expanded ? labels('output.collapse') : labels('output.expandLines').replace('{n}', String(lines)))
        : null
    )
  )
}

/**
 * An image output. It starts fitted to the pane and never enlarged past its
 * intrinsic size, and it offers the actual size **only when fitting actually
 * shrinks it** — on a small figure the control had nothing to reveal, which read
 * as a broken feature.
 */
function ImageOutput({ output, labels, primitives, query }) {
  const h = React.createElement
  const [actualSize, setActualSize] = React.useState(false)
  const [fit, setFit] = React.useState({ constrained: false, percent: 100 })
  const wrapRef = React.useRef(null)
  const src = imageSource(output)

  const onLoad = (event) => {
    const image = event !== null && event !== undefined ? event.currentTarget : undefined
    if (image === null || image === undefined) return
    // The image's own rendered width is the available width when it was fitted, and
    // it is the fallback when no wrapper has been attached yet — reading the wrapper
    // alone made this untestable and left the control invisible if the ref was null.
    const wrap = wrapRef.current
    const available = (wrap !== null && wrap !== undefined && wrap.clientWidth > 0 ? wrap.clientWidth : 0) || image.clientWidth || 0
    const viewport = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 0
    const natural = image.naturalWidth
    setFit({
      constrained: imageIsConstrained(natural, image.naturalHeight, available, viewport),
      percent: natural > 0 && available > 0 ? Math.min(100, Math.round((available / natural) * 100)) : 100
    })
  }

  if (src === undefined) {
    return h('p', { style: S.quiet }, labels('output.imageOmitted').replace('{size}', formatBytes(output.bytes)))
  }

  const style = actualSize
    ? { ...S.image, maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' }
    : { ...S.image, cursor: fit.constrained ? 'zoom-in' : 'default' }
  return h(
    'div',
    { ref: wrapRef, style: S.imageWrap },
    h('img', {
      src,
      alt: labels('output.image'),
      // A notebook of figures would otherwise decode every one of them up front.
      loading: 'lazy',
      decoding: 'async',
      title: fit.constrained ? labels(actualSize ? 'output.imageFit' : 'output.imageActual') : undefined,
      style,
      onLoad,
      onClick: fit.constrained ? () => setActualSize((value) => !value) : undefined
    }),
    // A figure is a raster: showing it at a fraction of its size shrinks its labels
    // too, so the fact that it *is* scaled is stated, with the way out beside it.
    fit.constrained
      ? h(
        'div',
        { style: S.outputTools },
        h(
          Control,
          { primitives, onClick: () => setActualSize((value) => !value) },
          labels(actualSize ? 'output.imageFit' : 'output.imageActual')
        ),
        h('span', { style: S.matchCount }, `${fit.percent}%`)
      )
      : null
  )
}

/** Render one normalized output. */
function OutputView({ output, wrap, labels, primitives, pathImages, forceCap, query }) {
  const h = React.createElement
  if (output.kind === 'stream') {
    // stderr is a second stream, not a failure: it keeps the neutral surface and
    // only its text takes the warning color, which an explicit SGR color overrides.
    const isStderr = output.name === 'stderr'
    const style = isStderr ? { ...S.out, color: T.warn } : S.out
    return h(TextOutput, {
      text: output.text,
      ansi: output.ansi,
      style,
      wrap,
      labels,
      primitives,
      forceCap,
      query,
      title: labels(isStderr ? 'output.stderr' : 'output.stdout')
    })
  }
  if (output.kind === 'error') {
    // Both paths run the same dedupe: coloring the raw traceback directly would drop
    // the `Name: value` head this text adds when a traceback does not end with it.
    return h(TextOutput, {
      text: errorOutputText(output),
      ansi: output.ansi === undefined ? undefined : errorOutputText(output, output.ansi),
      style: S.err,
      wrap,
      labels,
      primitives,
      forceCap,
      query
    })
  }
  if (output.kind === 'text') {
    // `text/markdown` and `text/latex` are content the markdown atom already knows
    // how to render; showing either as source was worse than the `text/plain`
    // fallback it outranked. A LaTeX payload carries no delimiters of its own.
    const isMarkdown = output.mime === 'text/markdown'
    const isLatex = output.mime === 'text/latex'
    if ((isMarkdown || isLatex) && isRenderable(primitives.MarkdownText)) {
      return h(primitives.MarkdownText, {
        text: isLatex ? `$$\n${output.text}\n$$` : output.text,
        labels: primitives.labels,
        pathImages
      })
    }
    return h(TextOutput, { text: output.text, style: S.out, wrap, labels, primitives, forceCap, query })
  }
  if (output.kind === 'json') {
    if (isRenderable(primitives.JsonTree)) {
      return h(primitives.JsonTree, { data: output.tree, label: output.mime, labels: primitives.jsonLabels })
    }
    return h(MissingAtom, { name: 'JsonTree', labels })
  }
  if (output.kind === 'html') {
    return h(HtmlOutput, { output, wrap, labels, pathImages, primitives })
  }
  if (output.kind === 'image') {
    return h(ImageOutput, { output, labels, primitives, query })
  }
  if (output.kind === 'image-placeholder') {
    return h('p', { style: S.quiet }, labels('output.imageOmitted').replace('{size}', formatBytes(output.bytes)))
  }
  return h('p', { style: S.quiet }, labels('output.unsupported').replace('{note}', String(output.note ?? 'unknown')))
}

/**
 * A control styled by the product when its `Button` is available.
 *
 * `Button` is a `forwardRef` component — an object, not a function — which is the
 * `isRenderable` case that a `typeof` check would have silently disabled.
 */
function Control({ primitives, onClick, title, children }) {
  const h = React.createElement
  if (isRenderable(primitives.Button)) {
    return h(primitives.Button, { size: 'sm', onClick, title }, children)
  }
  return h('button', { type: 'button', style: S.linkButton, onClick, title }, children)
}

/**
 * Whether this deployment can write to the clipboard at all.
 *
 * A copy control that silently does nothing is worse than no control: the reader
 * concludes the plugin is broken.
 */
function clipboardWriter(primitives) {
  if (isRenderable(primitives.writeClipboard)) return primitives.writeClipboard
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText.bind(navigator.clipboard)
  }
  return undefined
}

/**
 * Copy the given text with the host's own clipboard helper, flash a confirmation.
 */
function CopyControl({ text, primitives, labels }) {
  const h = React.createElement
  const [copied, setCopied] = React.useState(false)
  const write = clipboardWriter(primitives)
  if (write === undefined) return null
  const onClick = () => {
    Promise.resolve()
      .then(() => write(text))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), COPY_FLASH_MS)
      })
      .catch(() => {})
  }
  return h(Control, { primitives, onClick }, labels(copied ? 'copy.copied' : 'copy.text'))
}

/**
 * What this deployment actually provides, stated where a reader can see it.
 *
 * Every silent degradation in this plugin showed up first as "it does not work" —
 * a missing atom, a missing clipboard, theme variables that do not resolve, a
 * relative figure with no path to join. This panel is the plugin answering those
 * questions itself, including which build is running.
 */
function SelfCheck({ primitives, rows, labels }) {
  const h = React.createElement
  return h(
    'div',
    { style: S.selfCheck },
    h('div', { style: S.metaTitle }, labels('preview.selfCheckTitle')),
    rows.map((row) => h('div', { key: row.label, style: S.selfRow },
      h('span', { style: S.selfLabel }, labels(row.label)),
      h('span', null, row.value)
    ))
  )
}

/**
 * The notebook's contents, as a collapsible list.
 *
 * A `<select>` was the first version of this and it hid the structure: one flat line
 * per cell, no depth, and nothing to read at a glance. Headings are indented by their
 * own level, code cells get a prompt label, and the entry the reader is looking at is
 * marked while they scroll.
 */
function Outline({ entries, current, onJump, labels, showCodeToggle, codeShown, onToggleCode }) {
  const h = React.createElement
  const toggle = showCodeToggle
    ? h(
      'div',
      { style: S.outlineToggle },
      h(
        Control,
        { primitives: { Button: undefined }, onClick: onToggleCode },
        labels(codeShown ? 'preview.hideCodeCells' : 'preview.showCodeCells')
      )
    )
    : null
  if (entries.length === 0) {
    return h('div', { style: S.outlinePanel }, toggle, h('p', { style: S.quiet }, labels('preview.noOutline')))
  }
  return h(
    'div',
    { style: S.outlinePanel, role: 'navigation', 'aria-label': labels('preview.outline') },
    toggle,
    entries.map((entry) =>
      h(
        'button',
        {
          key: `${entry.kind}-${entry.index}-${entry.label}`,
          type: 'button',
          style: {
            ...S.outlineItem,
            ...(entry.index === current ? S.outlineItemCurrent : null),
            ...(entry.kind === 'heading' ? S.outlineHeading : null),
            paddingLeft: `${6 + Math.max(0, entry.level - 1) * 12}px`
          },
          title: entry.label,
          onClick: () => onJump(entry.index)
        },
        entry.kind === 'heading' ? entry.label : h('span', { style: S.outlineCode }, entry.label)
      )
    )
  )
}

/** A cell's tags, shown as the product's own pills. */
function TagRow({ tags, primitives }) {
  const h = React.createElement
  if (tags === undefined || tags.length === 0) return null
  return h(
    'div',
    { style: S.tagRow },
    tags.map((tag) =>
      isRenderable(primitives.Pill)
        ? h(primitives.Pill, { key: tag }, tag)
        : h('span', { key: tag, style: S.tagFallback }, tag)
    )
  )
}

/** Render one cell view model. `cell.index`/`cell.executionCount` are canonical. */
function CellView({ cell, wrap, labels, primitives, pathImages, registerCell, matched, activeMatch, query }) {
  const h = React.createElement
  // The card renders from a digest, which carries the run time as `ms`.
  const durationMs = cell.durationMs === undefined ? cell.ms : cell.durationMs
  // The cell element is handed to the outline, which scrolls to it: a ref map avoids
  // DOM ids that a second pane showing the same notebook would collide on.
  const cellRef = React.useMemo(
    () => (element) => {
      if (typeof registerCell === 'function') registerCell(cell.index, element)
    },
    [registerCell, cell.index]
  )
  const source = wrap ? { ...S.out, whiteSpace: 'pre-wrap' } : S.out
  // A code cell whose outputs a notebook saved collapsed starts that way; a reader can
  // collapse or reveal either half regardless of what the notebook recorded.
  const outputCount = (cell.outputs ?? []).length
  const [outputsShown, setOutputsShown] = React.useState(cell.collapsed !== true)
  const [sourcesShown, setSourcesShown] = React.useState(cell.sourceHidden !== true)
  // A cell's own attachments come first: an `attachment:` image is embedded in the
  // cell, so it needs neither a Host path nor a file read, and it works in the chat
  // card too. Anything else falls through to the notebook's file resolver.
  const resolveImage = React.useMemo(() => {
    const attached = cell.kind === 'markdown' || cell.kind === 'raw' ? cell.attachments : undefined
    if (attached === undefined && pathImages === undefined) return undefined
    return {
      resolve: (destination) => {
        const embedded = attachmentDataUrl(attached, destination)
        if (embedded !== undefined) return embedded
        return pathImages === undefined ? undefined : pathImages.resolve(destination)
      }
    }
  }, [cell.attachments, cell.kind, pathImages])
  // The gutter carries the only per-cell label: the Jupyter prompt. Markdown is
  // prose, so it gets none — an uppercase type tag above every cell is what made
  // this read like a debug dump.
  let prompt = ''
  if (cell.kind === 'code') {
    const counter = cell.executionCount === null || cell.executionCount === undefined ? ' ' : String(cell.executionCount)
    prompt = `${labels('cell.in')} [${counter}]`
  } else if (cell.kind === 'raw') {
    prompt = labels('cell.raw')
  }
  // Jupyter shows how long a cell ran; the notebook already recorded it.
  const duration = formatDuration(durationMs)

  let content
  if (cell.kind === 'code') {
    const outputs = (cell.outputs ?? []).map((output, at) =>
      h(OutputView, {
        key: `out-${at}`,
        output,
        wrap,
        labels,
        primitives,
        pathImages,
        forceCap: cell.scrolled === true,
        query
      })
    )
    content = h(
      'div',
      { style: S.body },
      h(TagRow, { tags: cell.tags, primitives }),
      // Jupyter's own hiding semantics, and a reader's own choice: the part stays
      // hidden, but a reader is told it exists rather than left with an empty-looking
      // cell. `metadata.collapsed` / `source_hidden` only set the initial state.
      sourcesShown
        ? isRenderable(primitives.CodeBlock)
          ? h(primitives.CodeBlock, {
            code: cell.source,
            lang: cell.language,
            lineNumbers: true,
            toolbarLabels: primitives.toolbarLabels,
            // Passing the owner's wrap preference hands the toolbar's wrap toggle
            // to the tab's own control instead of a second, conflicting one.
            wrap: wrap === undefined ? undefined : wrap === true,
            copyLabel: primitives.labels.code.copyLabel,
            copiedLabel: primitives.labels.code.copiedLabel
          })
          : h(MissingAtom, { name: 'CodeBlock', labels })
        : h('p', { style: S.quiet }, labels('output.sourceHidden')),
      h(
        'div',
        { style: S.outputTools },
        cell.sourceHidden === true && cell.source.trim().length === 0
          ? null
          : h(
            Control,
            { primitives, onClick: () => setSourcesShown((value) => !value) },
            labels(sourcesShown ? 'output.hideSource' : 'output.showSource')
          ),
        outputCount === 0
          ? null
          : h(
            Control,
            { primitives, onClick: () => setOutputsShown((value) => !value) },
            labels(outputsShown ? 'output.hideOutputs' : 'output.showOutputs')
          )
      ),
      outputsShown ? (cell.outputsHidden ? h('p', { style: S.quiet }, labels('output.outputsHidden')) : outputs) : null
    )
  } else if (cell.kind === 'markdown') {
    content = h(
      'div',
      { style: S.body },
      h(TagRow, { tags: cell.tags, primitives }),
      // `source_hidden` hides the rendered prose too: for markdown there is no
      // separate output to leave behind.
      cell.sourceHidden === true
        ? h('p', { style: S.quiet }, labels('output.sourceHidden'))
        : isRenderable(primitives.MarkdownText)
          ? h(primitives.MarkdownText, { text: cell.source, labels: primitives.labels, pathImages: resolveImage })
          : h(MissingAtom, { name: 'MarkdownText', labels }),
      h(CopyControl, { text: cell.source, primitives, labels })
    )
  } else {
    content = h('div', { style: S.body }, h('pre', { style: source }, cell.source))
  }

  // A search hit marks the cell; the current one is marked more strongly, so a reader
  // stepping through matches can see which is which without losing the whole set.
  const cellStyle = matched ? { ...S.cell, ...(activeMatch ? S.cellActiveMatch : S.cellMatch) } : S.cell
  return h(
    'div',
    { ref: cellRef, style: cellStyle },
    // The prompt sticks while its own cell scrolls past, which is what keeps a long
    // cell's number visible — the same thing Jupyter does.
    h(
      'div',
      { style: S.gutter },
      h('div', null, prompt),
      duration.length === 0 ? null : h('div', { style: S.duration, title: labels('cell.duration') }, duration)
    ),
    content
  )
}

/** Render a list of cell view models with the shared chrome. */
function NotebookCells({ cells, language, wrap, labels, primitives, pathImages, registerCell, matches, activeMatch, query }) {
  const h = React.createElement
  return [
    h('style', { key: 'dsh-jupyter-scoped-css' }, SCOPED_CSS),
    ...cells.map((cell) =>
      h(CellView, {
        key: `cell-${cell.index}`,
        cell: { ...cell, language },
        wrap,
        labels,
        primitives,
        pathImages,
        registerCell,
        matched: Array.isArray(matches) && matches.includes(cell.index),
        activeMatch: activeMatch === cell.index,
        query
      })
    )
  ]
}

/** Map a digest cell onto the canonical cell view model. */
function cellFromDigest(cell) {
  return {
    index: cell.i,
    kind: cell.kind,
    source: cell.source ?? '',
    executionCount: cell.exec === undefined ? null : cell.exec,
    outputs: cell.outputs ?? []
  }
}

/** Decode complete notebook bytes. Returns `undefined` when the bytes are not UTF-8. */
function decodeNotebookBytes(data) {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** The document-preview body: complete notebook bytes in, rendered notebook out. */
function NotebookBody(props) {
  const h = React.createElement
  const labels = props.labels
  const [showAll, setShowAll] = React.useState(false)
  const [rawMode, setRawMode] = React.useState(false)
  const [selfCheck, setSelfCheck] = React.useState(false)
  const [outlineOpen, setOutlineOpen] = React.useState(false)
  const [codeShown, setCodeShown] = React.useState(false)
  const [currentSection, setCurrentSection] = React.useState(undefined)
  const [tokens, setTokens] = React.useState({ checked: false, resolved: false })
  const rootRef = React.useRef(null)
  const [query, setQuery] = React.useState('')
  const [matchAt, setMatchAt] = React.useState(0)
  // Cell index to its rendered element, so the outline can scroll to one without
  // inventing DOM ids that two panes could collide on.
  const cellRefs = React.useMemo(() => new Map(), [])
  const registerCell = React.useMemo(() => (index, element) => {
    if (element === null || element === undefined) cellRefs.delete(index)
    else cellRefs.set(index, element)
  }, [cellRefs])
  const content = props.content
  const data = content !== null && typeof content === 'object' && content.kind === 'bytes' ? content.data : undefined

  // `useResource` is a standard prop of this slot and the shipped markdown body
  // reads the document's absolute path the same way. It is read defensively so an
  // unexpected owner degrades to "no relative images" instead of a caught render
  // error. Relative figures need that absolute path: the notebook's own address
  // may be workspace-relative.
  let absolutePath
  try {
    absolutePath = typeof props.useResource === 'function' ? props.useResource(props.resourceAddress).value?.absolutePath : undefined
  } catch {
    absolutePath = undefined
  }
  const pathImages = React.useMemo(() => {
    if (absolutePath === undefined || absolutePath === null) return undefined
    return {
      resolve: (destination) => (typeof document === 'undefined' ? undefined : markdownImageUrl(document.baseURI, absolutePath, destination))
    }
  }, [absolutePath])

  const parsed = React.useMemo(() => {
    if (data === undefined || data === null) return { state: 'pending' }
    const text = decodeNotebookBytes(data)
    if (text === undefined) return { state: 'invalid', reason: 'file is not valid UTF-8 text' }
    return parseNotebook(text)
  }, [data])

  // The file as saved, for the raw view — no re-serialization, so what a reader sees
  // is exactly what is on disk.
  const rawText = React.useMemo(() => {
    if (data === undefined || data === null) return ''
    return rawViewText(decodeNotebookBytes(data) ?? '').text
  }, [data])

  // The in-pane find. A notebook is long enough that scrolling for a name is the slow
  // way to answer "where is this".
  const matches = React.useMemo(() => {
    if (parsed.ok !== true) return []
    return findCells(parsed.notebook.cells, query)
  }, [parsed, query])
  // The navigable structure: headings are the spine, and a cell belongs under the
  // heading before it. Code entries are hidden by default when there are headings —
  // a long list of code lines is what makes a table of contents unusable.
  const outlineAll = React.useMemo(() => {
    if (parsed.ok !== true) return []
    return notebookOutline(parsed.notebook.cells, { includeCode: true })
  }, [parsed])
  const outlineHasHeadings = outlineAll.some((entry) => entry.kind === 'heading')
  const outline = codeShown || !outlineHasHeadings ? outlineAll : outlineAll.filter((entry) => entry.kind === 'heading')
  const step = (delta) => {    if (matches.length === 0) return
    const next = (matchAt + delta + matches.length) % matches.length
    setMatchAt(next)
    const element = cellRefs.get(matches[next])
    if (element !== undefined && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' })
    }
  }

  // A figure the notebook names relatively cannot be addressed without the document's
  // absolute path. Saying so beats a figure that silently never appears.
  const unresolvedImages = React.useMemo(() => {
    if (parsed.ok !== true || absolutePath !== undefined) return []
    return relativeImageDestinations(parsed.notebook.cells)
  }, [parsed, absolutePath])

  // Whether the theme's variables are readable from this subtree is the difference
  // between the theme's own colors and derived ones; the panel states which applies.
  React.useEffect(() => {
    const element = rootRef.current
    if (element === null || element === undefined || typeof getComputedStyle !== 'function') {
      setTokens({ checked: true, resolved: false })
      return
    }
    try {
      const value = getComputedStyle(element).getPropertyValue('--dsw-alias-label-primary').trim()
      setTokens({ checked: true, resolved: value.length > 0 })
    } catch {
      setTokens({ checked: true, resolved: false })
    }
  }, [])

  // The contents list marks the cell the reader is looking at. The scrollport belongs
  // to the preview owner, but a capture-phase listener on the window still sees its
  // scroll events, and a frame is coalesced into one measurement.
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    if (!outlineOpen) return undefined
    let frame
    const measure = () => {
      frame = undefined
      let best
      for (const [index, element] of cellRefs) {
        if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') continue
        const top = element.getBoundingClientRect().top
        if (top <= 8 && (best === undefined || top > best.top)) best = { index, top }
        if (best === undefined && top > 8) best = { index, top }
      }
      if (best !== undefined) setCurrentSection(best.index)
    }
    const onScroll = () => {
      if (frame !== undefined) return
      frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : setTimeout(measure, 100)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    measure()
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (typeof cancelAnimationFrame === 'function' && typeof frame === 'number') cancelAnimationFrame(frame)
    }
  }, [outlineOpen, cellRefs])

  const children = []
  if (parsed.state === 'pending') {    children.push(h('p', { style: S.quiet }, labels('preview.incomplete')))
  } else if (parsed.ok !== true) {
    children.push(
      h(
        'div',
        { key: 'error', style: S.error },
        h('div', { style: S.errorTitle }, labels('error.title')),
        h('div', null, String(parsed.error))
      )
    )
  } else {
    const notebook = parsed.notebook
    const executed = notebook.cells.filter((cell) => cell.kind === 'code' && cell.executionCount !== null).length
    const limit = showAll ? notebook.cells.length : LIMITS.previewMaxCells
    const visible = notebook.cells.slice(0, limit)
    children.push(
      h(
        'div',
        { key: 'meta', style: S.meta },
        h('span', null, `${notebook.cellCount} ${labels('preview.cells')}`),
        h('span', { style: S.separator }, '·'),
        h('span', null, `${executed} ${labels('preview.executed')}`),
        notebook.kernel ? h('span', { style: S.separator }, '·') : null,
        notebook.kernel ? h('span', null, `${labels('preview.kernel')}: ${notebook.kernel}`) : null,
        notebook.cellCount > limit
          ? h(Control, { primitives: props.primitives, onClick: () => setShowAll(true) }, labels('preview.showAll'))
          : null,
        // The contents toggle lives in the rail, not here: the rail is visible in both
        // states and stays put while the notebook scrolls, so a second toggle at the
        // top would be a duplicate that scrolls away.
        // The escape hatch: a reader who wants the file itself, not this rendering,
        // should not have to leave the harness for it.
        h(
          Control,
          { primitives: props.primitives, onClick: () => setRawMode((value) => !value) },
          labels(rawMode ? 'preview.showRendered' : 'preview.showRaw')
        ),
        h('input', {
          key: 'find',
          type: 'search',
          value: query,
          placeholder: labels('preview.find'),
          'aria-label': labels('preview.find'),
          style: S.findInput,
          onChange: (event) => {
            setQuery(event.target.value)
            setMatchAt(0)
          },
          // Stepping from the keyboard keeps the hand where the query was typed.
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              step(event.shiftKey ? -1 : 1)
            } else if (event.key === 'Escape') {
              setQuery('')
              setMatchAt(0)
            }
          }
        }),
        query.trim().length === 0
          ? null
          : matches.length === 0
            ? h('span', { key: 'none', style: S.quiet }, labels('preview.noMatches'))
            : h(
              'span',
              { key: 'count', style: S.matchCount },
              `${(matchAt % matches.length) + 1}/${matches.length}`
            ),
        matches.length > 1
          ? h(
            Control,
            { primitives: props.primitives, onClick: () => step(-1) },
            labels('preview.previous')
          )
          : null,
        matches.length > 1
          ? h(Control, { primitives: props.primitives, onClick: () => step(1) }, labels('preview.next'))
          : null,
        // The rail carries the contents toggle instead, so it stays reachable while
        // the notebook scrolls.
        h(
          Control,
          { primitives: props.primitives, onClick: () => setSelfCheck((value) => !value) },
          labels('preview.selfCheck')
        )
      ),
      selfCheck
        ? h(SelfCheck, {
          key: 'self-check',
          primitives: props.primitives,
          labels,
          rows: [
            { label: 'self.build', value: typeof BUILD_ID === 'undefined' ? labels('self.unknown') : BUILD_ID },
            {
              label: 'self.atoms',
              value: ATOM_NAMES.map((name) => `${name} ${isRenderable(props.primitives[name]) ? '✓' : '✗'}`).join(' · ')
            },
            {
              label: 'self.clipboard',
              value: labels(clipboardWriter(props.primitives) === undefined ? 'self.unavailable' : 'self.available')
            },
            {
              label: 'self.themeTokens',
              value: tokens.checked
                ? labels(tokens.resolved ? 'self.resolved' : 'self.derived')
                : labels('self.unknown')
            },
            {
              label: 'self.hostPath',
              value: labels(absolutePath === undefined ? 'self.absent' : 'self.present')
            },
            { label: 'self.cells', value: `${visible.length}/${notebook.cellCount}` },
            {
              label: 'self.viewport',
              value:
                typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
                  ? `${window.innerWidth}×${window.innerHeight}`
                  : labels('self.unknown')
            }
          ]
        })
        : null,
      // A relative figure with no absolute path to join is stated, not left to look
      // like a broken image.
      unresolvedImages.length === 0
        ? null
        : h(
          'p',
          { key: 'relative-images', style: S.quiet },
          labels('preview.relativeImages').replace(
            '{list}',
            `${unresolvedImages.slice(0, 4).join(', ')}${unresolvedImages.length > 4 ? ' …' : ''}`
          )
        ),
      // The navigation rail and the notebook, side by side. The rail is sticky so it
      // stays reachable while the notebook scrolls — a table of contents that scrolls
      // away has to be scrolled back to before it can be used, which is most of its
      // value gone. Collapsed it is a narrow strip that still carries its own toggle,
      // for the same reason.
      h(
        'div',
        { key: 'workspace', style: S.workspace },
        rawMode
          ? null
          : h(
            'div',
            { style: outlineOpen ? S.rail : S.railCollapsed },
            h(
              Control,
              { primitives: props.primitives, onClick: () => setOutlineOpen((value) => !value) },
              labels(outlineOpen ? 'preview.hideOutline' : 'preview.showOutline')
            ),
            outlineOpen
              ? h(Outline, {
                entries: outline,
                current: currentSection,
                // Only worth offering when there are headings to nest under.
                showCodeToggle: outlineHasHeadings,
                codeShown,
                onToggleCode: () => setCodeShown((value) => !value),
                onJump: (index) => {
                  const element = cellRefs.get(index)
                  if (element !== undefined && typeof element.scrollIntoView === 'function') {
                    element.scrollIntoView({ block: 'start' })
                  }
                  setCurrentSection(index)
                },
                labels
              })
              : null
          ),
        h(
          'div',
          { style: S.workspaceBody },
          rawMode
            ? h('pre', { style: S.raw }, rawText)
            : h(NotebookCells, {
              cells: visible,
              language: notebook.language,
              wrap: props.wrap,
              labels,
              primitives: props.primitives,
              pathImages,
              registerCell,
              matches,
              activeMatch: matches.length > 0 ? matches[matchAt % matches.length] : undefined,
              query
            })
        )
      )
    )
  }

  // Deliberately **not** reporting `props.scrollportRef`. The contract is "report a
  // renderer-owned scrollport" — this body does not own one, the preview owner's own
  // body element scrolls (`overflow: auto`), and that is the element the owner saves
  // and restores `scrollTop` on. Attaching the ref to this non-scrolling root
  // hijacked it: restoration then read and wrote a `scrollTop` that is always 0.
  return h('div', { ref: rootRef, className: 'dsh-jupyter', style: S.root }, children)
}

/** Parse the tool call's raw arguments without trusting them. */
function toolArgs(block) {
  if (block === null || typeof block !== 'object') return undefined
  const raw = typeof block.argsRaw === 'string' ? block.argsRaw : block.call && typeof block.call.argsRaw === 'string' ? block.call.argsRaw : ''
  if (raw.length === 0) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Recover a digest from a settled result, preferring the declared presentation metadata. */
function digestOf(block) {
  if (block === null || typeof block !== 'object') return undefined
  const meta = block.meta
  if (meta !== null && typeof meta === 'object' && meta.v === 1 && Array.isArray(meta.cells)) return meta
  const content = Array.isArray(block.content) ? block.content : []
  for (const part of content) {
    if (part === null || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') continue
    try {
      const value = JSON.parse(part.text)
      if (value !== null && typeof value === 'object' && value.v === 1 && Array.isArray(value.cells)) return value
    } catch {
      // A non-JSON text result simply has no digest.
    }
  }
  return undefined
}

/** One-line failure text for a settled error result. */
function failureText(block) {
  const content = Array.isArray(block.content) ? block.content : []
  const texts = []
  for (const part of content) {
    if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
  }
  return texts.join('\n')
}

/** The tool card for `read_notebook`. */
function ReadNotebookCard(props) {
  const h = React.createElement
  const labels = props.labels
  const block = props.block
  const args = toolArgs(block)
  const path = args && typeof args.file_path === 'string' ? args.file_path : undefined
  const settled = props.phase === 'result'
  const digest = settled ? digestOf(block) : undefined

  const head = h(
    'div',
    { style: S.cardHead },
    h('span', { style: S.cardPath, title: path ?? '' }, path ?? labels('card.noPath')),
    h('span', { style: { flex: '1 1 auto' } }),
    digest !== undefined
      ? h('span', { style: { opacity: 0.65, fontSize: '12px' } }, digestSummary(digest, {
        cells: labels('summary.cells'),
        code: labels('summary.code'),
        executed: labels('summary.executed'),
        truncated: labels('summary.truncated')
      }))
      : null,
    path !== undefined && typeof props.openFile === 'function'
      ? h('button', { type: 'button', style: S.button, onClick: () => props.openFile(path) }, labels('card.open'))
      : null
  )

  let body
  if (!settled) {
    body = h('div', { style: { padding: '10px 12px' } }, h('p', { style: S.quiet }, labels('card.running')))
  } else if (block.isError === true && digest === undefined) {
    body = h('div', { style: { padding: '10px 12px' } }, h('pre', { style: S.err }, failureText(block)))
  } else if (digest === undefined) {
    body = h('div', { style: { padding: '10px 12px' } }, h('p', { style: S.quiet }, labels('card.digestMissing')))
  } else {
    body = h(
      'div',
      { style: S.cardBody },
      h(
        'div',
        { style: S.root },
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
          digest.language ? h('span', null, digest.language) : null,
          digest.kernel ? h('span', null, `${labels('preview.kernel')}: ${digest.kernel}`) : null
        ),
        h(NotebookCells, {
          cells: digest.cells.map(cellFromDigest),
          language: digest.language,
          wrap: true,
          labels,
          primitives: props.primitives
        })
      )
    )
  }

  return h('div', { className: 'dsh-jupyter', style: S.card }, head, body)
}

/** Register the preview implementation and the tool card. */
function apply(ctx) {
  const slots = ctx.get('slots')
  const locale = ctx.get('locale')
  const primitives = PRIMITIVES

  let translate
  if (locale === undefined) {
    translate = (key) => EN[key] ?? key
  } else {
    ctx.effect(() => locale.register(LOCALE_NS, { zh: ZH, en: EN }))
    const bound = locale.bind(LOCALE_NS)
    // A missing message must degrade to the bundled English copy, never throw
    // inside a render: this runs per label, in the middle of a component.
    translate = (key, params) => {
      try {
        const value = bound(key, params)
        // `value !== key` matters: a locale service that answers a missing message
        // with the key itself must still fall through to the bundled copy, or the
        // user sees `output.expandLines` instead of English text.
        if (typeof value === 'string' && value.length > 0 && value !== key) return value
      } catch (error) {
        console.warn(`[dsh-jupyter] locale lookup failed for ${key}`, error)
      }
      return EN[key] ?? key
    }
  }

  const labels = (key) => translate(key)
  // A missing atom used to degrade silently, which made a broken renderer look
  // like unstyled output. Report it once, with enough detail to tell a missing
  // export from a module that did not resolve — and `memo`/`forwardRef` objects
  // from plain data, since the first version of this check got that wrong.
  const atomShape = (value) => {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'function') return 'function'
    if (typeof value === 'object') return typeof value.$$typeof === 'symbol' ? 'exotic component' : 'object'
    return typeof value
  }
  const missingAtoms = ['MarkdownText', 'CodeBlock', 'JsonTree'].filter((name) => !isRenderable(primitives[name]))
  if (missingAtoms.length > 0) {
    console.warn(
      '[dsh-jupyter] primitives not renderable:',
      missingAtoms.map((name) => `${name}=${atomShape(primitives[name])}`).join(', '),
      '| module keys:',
      primitives !== null && typeof primitives === 'object' ? Object.keys(primitives).length : 0
    )
  }
  // The atoms are locale-free and the deployed versions *dereference* every one
  // of these rather than falling back, so each object below is a complete
  // contract, not a partial override. `JsonTree` additionally calls
  // `labels.copyButtonTitle(action)` and reads the expander aria labels, so all
  // ten keys are supplied. Built once: a changing identity discards the
  // markdown streaming render cache.
  const toolbarLabels = {
    codeLabel: labels('code.label'),
    wrapLabel: labels('code.wrap'),
    unwrapLabel: labels('code.unwrap')
  }
  const primitiveLabels = {
    code: { copyLabel: labels('code.copy'), copiedLabel: labels('code.copied'), toolbarLabels },
    footnotes: labels('markdown.footnotes')
  }
  const jsonLabels = {
    copyValue: labels('json.copyValue'),
    copyJson: labels('json.copyJson'),
    copyPath: labels('json.copyPath'),
    copyPrettyJson: labels('json.copyPrettyJson'),
    copyCompactJson: labels('json.copyCompactJson'),
    copied: labels('code.copied'),
    copyFailed: labels('json.copyFailed'),
    collapseNode: labels('json.collapseNode'),
    expandNode: labels('json.expandNode'),
    copyButtonTitle: (action) => labels('json.copyButtonTitle').replace('{action}', String(action))
  }
  const primitivesBag = {
    MarkdownText: primitives.MarkdownText,
    CodeBlock: primitives.CodeBlock,
    JsonTree: primitives.JsonTree,
    // The product's controls. Anything a component reads through this bag must be
    // listed here: the bag, not the module, is what reaches the tree — leaving one
    // out silently disables its feature and sends it down the fallback path.
    Button: primitives.Button,
    Pill: primitives.Pill,
    writeClipboard: primitives.writeClipboard,
    labels: primitiveLabels,
    toolbarLabels,
    jsonLabels
  }

  function Body(props) {
    return React.createElement(
      Guard,
      { title: labels('render.failed') },
      React.createElement(NotebookBody, { ...props, labels, primitives: primitivesBag })
    )
  }
  function Card(props) {
    return React.createElement(
      Guard,
      { title: labels('render.failed') },
      React.createElement(ReadNotebookCard, { ...props, labels, primitives: primitivesBag })
    )
  }

  if (slots !== undefined) {
    ctx.effect(() =>
      slots.inject('tool.call.toolview', () =>
        slots.register({ name: 'tool.call.toolview', key: CARD_TOOL_KEY, locale: LOCALE_NS }, Card)
      )
    )
  }

  // The preview belongs to the document-preview package, and on a cold start
  // that package has not provided its registry yet when this plugin activates.
  // A one-shot `ctx.get('documentPreviews')` therefore returned undefined and
  // skipped the whole registration silently, so `.ipynb` never appeared in the
  // renderer dropdown — while a hot-loaded plugin, activating long after the
  // preview existed, worked. `ctx.inject` is Cordis's contract for exactly this
  // case: the callback runs once the service is available, and is unloaded and
  // re-run whenever it changes.
  ctx.inject(['documentPreviews'], (scoped) => {
    const registry = scoped.get('documentPreviews')
    if (registry === undefined || typeof registry.register !== 'function') {
      console.warn('[dsh-jupyter] documentPreviews provides no register(); notebook preview disabled')
      return
    }
    if (slots === undefined) return
    scoped.effect(() =>
      registry.register({
        id: PREVIEW_ID,
        extensions: ['ipynb'],
        priority: 'extension',
        title: () => labels('viewer.label'),
        loading: 'bytes-complete',
        // The body honours the owner's wrap preference (code and text both), so
        // the tab's wrap control has something to drive.
        wrap: true
      })
    )
    scoped.effect(() =>
      slots.inject('sidebar.right.tab.document', () =>
        slots.register({ name: 'sidebar.right.tab.document', key: PREVIEW_ID, locale: LOCALE_NS }, Body)
      )
    )
  })
}

const inject = ['slots', 'locale']

exports.apply = apply
exports.inject = inject
