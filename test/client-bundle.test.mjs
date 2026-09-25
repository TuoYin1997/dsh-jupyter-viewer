import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { ANSI_PALETTE, LIMITS, findCells, parseNotebook } from '../src/notebook.js'

/** Every text handed to the stub clipboard helper, in order. */
const clipboardWrites = []

/**
 * The stub primitives mirror the *contracts the shipped 0.1.7 components
 * actually enforce*, because an over-permissive stub is what let a real crash
 * through once already: `MarkdownText` dereferences `labels.code.copyLabel`, and
 * `CodeBlock`'s banner renders `copyLabel`/`copiedLabel`.
 */
function stubPrimitives(overrides = {}) {
  return {
    MarkdownText(props) {
      if (props === null || typeof props !== 'object') throw new TypeError('MarkdownText: props required')
      if (typeof props.text !== 'string') throw new TypeError('MarkdownText: text must be a string')
      const copyLabel = props.labels?.code?.copyLabel
      if (typeof copyLabel !== 'string' || copyLabel.length === 0) {
        throw new TypeError("Cannot read properties of undefined (reading 'copyLabel')")
      }
      return { type: 'MarkdownText', props }
    },
    CodeBlock(props) {
      if (props === null || typeof props !== 'object') throw new TypeError('CodeBlock: props required')
      if (typeof props.code !== 'string') throw new TypeError('CodeBlock: code must be a string')
      if (typeof props.copyLabel !== 'string' || typeof props.copiedLabel !== 'string') {
        throw new TypeError('CodeBlock: copyLabel and copiedLabel are required')
      }
      // Providing toolbarLabels selects the CodeToolbar banner, and that component
      // dereferences exactly these three keys.
      const toolbar = props.toolbarLabels
      if (toolbar === null || typeof toolbar !== 'object') {
        throw new TypeError("Cannot read properties of undefined (reading 'codeLabel')")
      }
      for (const key of ['codeLabel', 'wrapLabel', 'unwrapLabel']) {
        if (typeof toolbar[key] !== 'string' || toolbar[key].length === 0) {
          throw new TypeError(`CodeBlock: toolbarLabels.${key} is required`)
        }
      }
      return { type: 'CodeBlock', props }
    },
    JsonTree(props) {
      if (props === null || typeof props !== 'object') throw new TypeError('JsonTree: props required')
      if (typeof props.data !== 'object' || props.data === null) throw new TypeError('JsonTree: data must be an object or array')
      const labels = props.labels
      if (labels === null || typeof labels !== 'object') {
        throw new TypeError("Cannot read properties of undefined (reading 'expandNode')")
      }
      for (const key of [
        'copyValue',
        'copyJson',
        'copyPath',
        'copyPrettyJson',
        'copyCompactJson',
        'copied',
        'copyFailed',
        'collapseNode',
        'expandNode'
      ]) {
        if (typeof labels[key] !== 'string' || labels[key].length === 0) {
          throw new TypeError(`JsonTree: labels.${key} is required`)
        }
      }
      if (typeof labels.copyButtonTitle !== 'function') {
        throw new TypeError('JsonTree: labels.copyButtonTitle must be a function')
      }
      return { type: 'JsonTree', props }
    },
    // The product's own controls. `Button` is a `forwardRef`, so it is an object
    // rather than a function — the shape a `typeof` check would have disabled.
    Button: { $$typeof: Symbol.for('react.forward_ref'), render: (props) => ({ type: 'Button', props }) },
    Pill: (props) => {
      if (typeof props.children !== 'string') throw new TypeError('Pill: children must be the label')
      return { type: 'Pill', props }
    },
    writeClipboard: (text) => {
      clipboardWrites.push(text)
      return Promise.resolve(true)
    },
    ...overrides
  }
}

/**
 * Load `lib/client.js` the way the web shell does: hand it a
 * `window.__ModuleLoader__` and a `require` that answers with the statically
 * seeded modules, then materialize the factory. This catches a stale build, a
 * bad wrapper, and any `require` the platform table cannot satisfy — none of
 * which a syntax check would notice.
 */
function loadBundle(primitiveOverrides = {}) {
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  const rows = []
  // A browser-shaped window: `innerHeight` matters, because the image sizing reads it
  // and a missing viewport makes the code refuse to promise a zoom control.
  const window = { __ModuleLoader__: { load: (row) => rows.push(row) }, innerHeight: 800, innerWidth: 1200 }
  const requested = []

  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  }

  // The same react stub the stateful renderer installs, so a click replayed by
  // `interactive` updates the hooks the components actually read.
  const react = createReact()
  const primitives = stubPrimitives(primitiveOverrides)
  const require = (id) => {
    requested.push(id)
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require("${id}")`)
  }

  const runner = new Function('window', 'require', 'console', source)
  runner(window, require, { warn() {}, error() {} })
  assert.equal(rows.length, 1, 'the bundle must register exactly one module row')
  return { row: rows[0], requested, exports: rows[0].factory(require) }
}

/**
 * React's `memo` and `forwardRef` element types are objects, not functions.
 * @param type - a candidate element type.
 * @returns the function to render through, or undefined for a host type.
 */
const exoticType = (type) => {
  if (type === null || typeof type !== 'object' || typeof type.$$typeof !== 'symbol') return undefined
  if (typeof type.type === 'function') return type.type
  if (typeof type.render === 'function') return (props) => type.render(props, null)
  return undefined
}

/**
 * A minimal stateful reconciler for tests.
 *
 * A stateless expansion can only ever assert the first render, which leaves every
 * click-driven behaviour — expanding a long output, revealing a collapsed one,
 * switching to the raw view — unverified. This keeps one hook store per component
 * instance, keyed by its position and key in the tree, so an event handler's state
 * update can be replayed by re-rendering from the root.
 */
function createStore() {
  return { instances: new Map(), current: 'root', pending: [], elements: new Map(), scrolled: [] }
}

/** The hook store the current render pass is using. */
let activeStore = createStore()

/** Shallow comparison, which is what the hook dependency contract needs. */
function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, at) => Object.is(value, b[at]))
}

/**
 * Enter a component instance: create its store on first render and reset the hook
 * cursor. Called **once** per component render — resetting it again per hook would
 * make every hook read slot 0.
 */
function beginInstance(store, path) {
  let instance = store.instances.get(path)
  if (instance === undefined) {
    instance = { states: [], memos: [], refs: [], effects: [], cursor: 0 }
    store.instances.set(path, instance)
  }
  instance.cursor = 0
  return instance
}

/** A stand-in for a rendered DOM element, stable per position in the tree. */
function elementAt(store, path) {
  let element = store.elements.get(path)
  if (element === undefined) {
    element = {
      path,
      clientWidth: 0,
      clientHeight: 0,
      scrollTop: 0,
      backgroundColor: 'rgba(0, 0, 0, 0)',
      parentElement: null,
      // Recorded, so "clicking the contents jumps to that cell" can be asserted.
      scrollIntoView: () => store.scrolled.push(path),
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
    }
    store.elements.set(path, element)
  }
  return element
}

/** Run the effects a render queued, as React does after committing. */
function flushEffects(store) {
  const queue = store.pending
  store.pending = []
  for (const entry of queue) {
    const previous = entry.instance.effects[entry.at]
    if (typeof previous?.cleanup === 'function') {
      try {
        previous.cleanup()
      } catch {
        // A failing cleanup is not the test's subject.
      }
    }
    const cleanup = entry.effect()
    entry.instance.effects[entry.at] = {
      deps: previous?.deps,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined
    }
  }
  return queue.length
}

/** Build the `react` stub. Hooks read `activeStore`, which a render pass sets. */
function createReact() {
  const slot = () => {
    const instance = activeStore.instances.get(activeStore.current)
    return { instance, at: instance.cursor++ }
  }
  return {
    Component: class Component {
      constructor(props) {
        this.props = props
        this.state = {}
      }
    },
    createElement: (type, props, ...children) => {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    memo: (component) => component,
    useState: (initial) => {
      const { instance, at } = slot()
      if (instance.states.length <= at) instance.states[at] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(instance.states[at]) : next
        if (Object.is(value, instance.states[at])) return
        instance.states[at] = value
      }
      return [instance.states[at], set]
    },
    useMemo: (factory, deps) => {
      const { instance, at } = slot()
      const previous = instance.memos[at]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value
      const value = factory()
      instance.memos[at] = { value, deps }
      return value
    },
    useRef: (initial) => {
      const { instance, at } = slot()
      if (instance.refs.length <= at) instance.refs[at] = { current: initial === undefined ? null : initial }
      return instance.refs[at]
    },
    useEffect: (effect, deps) => {
      const { instance, at } = slot()
      const previous = instance.effects[at]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return
      instance.effects[at] = { deps, cleanup: previous?.cleanup }
      activeStore.pending.push({ instance, at, effect })
    },
    useLayoutEffect: (effect, deps) => {
      const { instance, at } = slot()
      const previous = instance.effects[at]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return
      instance.effects[at] = { deps, cleanup: previous?.cleanup }
      activeStore.pending.push({ instance, at, effect })
    }
  }
}

/**
 * Expand a component tree the way the reconciler does: function components run,
 * `memo`/`forwardRef` types run their inner function, and class components run
 * inside their own error boundary.
 * @param node - an element, an array of elements, or a primitive.
 * @param store - the hook store, so state survives a re-render.
 * @param path - the position of this node, used as the instance key.
 * @returns the tree with only host nodes and primitives left.
 */
function renderTreeAt(node, store, path = 'root') {
  if (store !== undefined) activeStore = store
  const active = activeStore
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map((child, at) => renderTreeAt(child, active, `${path}.${child?.props?.key ?? at}`))
  }
  const { type, props } = node
  const inner = exoticType(type)
  if (inner !== undefined) return renderTreeAt({ type: inner, props }, active, path)
  if (typeof type === 'function') {
    const isClass = typeof type.prototype?.render === 'function'
    if (!isClass) {
      const previous = active.current
      active.current = path
      beginInstance(active, path)
      try {
        return renderTreeAt(type(props), active, path)
      } finally {
        active.current = previous
      }
    }
    const instance = new type(props)
    try {
      return renderTreeAt(instance.render(), active, path)
    } catch (error) {
      if (typeof type.getDerivedStateFromError !== 'function') throw error
      instance.state = { ...instance.state, ...type.getDerivedStateFromError(error) }
      if (typeof instance.componentDidCatch === 'function') instance.componentDidCatch(error)
      return renderTreeAt(instance.render(), active, path)
    }
  }
  const next = { ...props }
  if ('children' in next) next.children = renderTreeAt(next.children, active, path)
  // React accepts both a callback ref and the `{ current }` object a `useRef` returns,
  // and effects and measurements depend on one of them having been populated.
  const ref = props?.ref
  if (typeof ref === 'function') ref(elementAt(active, path))
  else if (ref !== null && ref !== undefined && typeof ref === 'object') ref.current = elementAt(active, path)
  return { type, props: next }
}

/**
 * Render, then run the effects it queued and render again while they keep changing
 * state — which is what makes a theme read or a measurement assertable.
 * @param component - the component function.
 * @param props - its props.
 * @param store - the hook store to keep across rounds.
 * @returns the settled tree.
 */
function renderWithEffects(component, props, store) {
  let tree = renderTreeAt(component(props), store)
  // A bounded number of rounds: nothing should need more, and an effect that sets
  // state unconditionally every pass must not hang the suite.
  for (let round = 0; round < 20 && store.pending.length > 0; round += 1) {
    flushEffects(store)
    tree = renderTreeAt(component(props), store)
  }
  return tree
}

/** Expand one element statelessly, for assertions about the first render. */
const renderTree = (node) => renderTreeAt(node, createStore())

/** Invoke one registered component with props and expand the result. */
const rendered = (component, props) => renderWithEffects(component, props, createStore())

/**
 * Render a component so its click handlers can be replayed.
 *
 * `clickLabel` finds the first control whose text contains the label, invokes its
 * handler, and re-renders through the same hook store — which is what makes a
 * state-driven behaviour assertable instead of merely wired up.
 * @param component - the registered component function.
 * @param props - its props.
 * @returns a handle with the current tree, a label-aware click, and its text.
 */
function interactive(component, props) {
  const store = createStore()
  let tree = renderWithEffects(component, props, store)
  const handle = {
    get tree() {
      return tree
    },
    /** The tree positions that were scrolled into view, in order. */
    get scrolled() {
      return store.scrolled
    },
    clickLabel(label) {
      const target = findAll(
        tree,
        (node) => typeof node.props?.onClick === 'function' && collectStrings(node).join(' ').includes(label)
      )[0]
      assert.notEqual(target, undefined, `no control labelled ${label}`)
      target.props.onClick()
      tree = renderWithEffects(component, props, store)
      return handle
    },
    /** Type into the input whose accessible name is `label`. */
    type(label, value) {
      const target = findAll(tree, (node) => node.type === 'input' && node.props['aria-label'] === label)[0]
      assert.notEqual(target, undefined, `no input labelled ${label}`)
      target.props.onChange({ target: { value } })
      tree = renderWithEffects(component, props, store)
      return handle
    },
    /** Press a key in the input whose accessible name is `label`. */
    press(label, event) {
      const target = findAll(tree, (node) => node.type === 'input' && node.props['aria-label'] === label)[0]
      assert.notEqual(target, undefined, `no input labelled ${label}`)
      target.props.onKeyDown({ preventDefault: () => {}, ...event })
      tree = renderWithEffects(component, props, store)
      return handle
    },
    /** Re-render after invoking a handler by hand, as a browser event would. */
    rerender() {
      tree = renderWithEffects(component, props, store)
      return handle
    },
    text() {
      return collectStrings(tree).join('\n')
    }
  }
  return handle
}

const sampleText = readFileSync(fileURLToPath(new URL('./fixtures/sample.ipynb', import.meta.url)), 'utf8')

/** Walk a React-stub element tree. */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  walk(node.props?.children, visit)
}

const findAll = (tree, predicate) => {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

/** Register the plugin against a fake client context and return what it registered. */
function mount(options = {}) {
  const loaded = loadBundle(options.primitiveOverrides ?? {})
  const registered = new Map()
  const dictionary = {
    'viewer.label': 'Jupyter Notebook',
    'preview.cells': 'cells',
    'preview.executed': 'executed',
    'preview.kernel': 'kernel',
    'preview.showAll': 'Show all cells',
    'preview.incomplete': 'incomplete',
    'summary.cells': '{n} 个单元格',
    'summary.code': '{n} 段代码',
    'summary.executed': '{n} 个已执行',
    'summary.truncated': '已截断',
    'error.title': 'This notebook could not be rendered',
    'cell.in': 'In',
    'cell.markdown': 'Markdown',
    'cell.code': 'Code',
    'cell.raw': 'Raw',
    'code.copy': 'Copy',
    'code.copied': 'Copied',
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
    'atom.missing': 'This deployment does not expose {name}; showing plain text instead',
    'output.stdout': 'stdout',
    'output.stderr': 'stderr',
    'output.html': 'HTML output',
    'output.htmlTooLarge': 'too large',
    'output.htmlExpand': 'Show more',
    'output.htmlCollapse': 'Show less',
    'output.expandLines': 'Show all {n} lines',
    'output.collapse': 'Collapse',
    'output.imageActual': 'View actual size',
    'output.imageFit': 'Fit width',
    'output.image': 'Image output',
    'output.showOutputs': 'Show output',
    'output.hideOutputs': 'Hide output',
    'code.label': 'Code',
    'code.wrap': 'Wrap lines',
    'code.unwrap': 'Unwrap lines',
    'output.imageOmitted': 'Image output ({size}); open the preview tab',
    'output.unsupported': 'not rendered: {note}',
    'card.open': 'Open in preview',
    'card.file': 'File',
    'card.noPath': 'No file path was provided',
    'card.running': 'Reading the notebook…',
    'card.digestMissing': 'no data'
  }

  const slots = {
    inject(name, callback) {
      callback()
      return () => {}
    },
    register(options, component) {
      registered.set(`${options.name}|${options.key ?? options.id}`, { options, component })
      return () => {}
    }
  }
  const documentPreviews = {
    register(definition) {
      registered.set(`documentPreviews|${definition.id}`, { definition })
      return () => {}
    }
  }
  const locale = {
    register: () => () => {},
    bind: () => (key) => dictionary[key] ?? key
  }
  const services = {
    slots,
    locale,
    documentPreviews: options.registryAvailable === false ? undefined : documentPreviews
  }
  const effects = []
  const pending = []
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => {
      const dispose = fn()
      effects.push(dispose)
      return () => {}
    },
    on: () => () => {},
    inject: (deps, callback) => {
      // `deferInject` models a cold start: the service the callback needs is not
      // provided yet when `apply` runs, so Cordis runs the callback later.
      if (options.deferInject === true) {
        pending.push(() => callback(ctx))
        return Promise.resolve()
      }
      callback(ctx)
      return Promise.resolve()
    }
  }

  loaded.exports.apply(ctx)
  return { ...loaded, registered, effects, pending }
}

test('the bundle registers one row under the package name and exposes apply/inject', () => {
  const { row, exports, requested } = loadBundle()
  // Read from the manifest rather than repeating it: the module id *is* the package
  // name, and a hard-coded copy here drifts the moment the package is renamed.
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(row.id, manifest.name)
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.deepEqual(requested, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
})

test('apply claims the .ipynb preview and the tool card', () => {
  const { registered } = mount()
  const definition = registered.get('documentPreviews|jupyter-notebook')?.definition
  assert.equal(definition.extensions[0], 'ipynb')
  assert.equal(definition.priority, 'extension')
  assert.equal(definition.loading, 'bytes-complete')
  assert.equal(typeof definition.title(), 'string')
  assert.equal(registered.has('sidebar.right.tab.document|jupyter-notebook'), true)
  assert.equal(registered.has('tool.call.toolview|read_notebook'), true)
})

test('the preview waits for the registry instead of silently skipping it', () => {
  // The regression this pins: on a cold start the document-preview package has
  // not provided its registry yet when this plugin activates, so a one-shot
  // `ctx.get('documentPreviews')` returned undefined and the renderer was never
  // registered — `.ipynb` then never appeared in the renderer dropdown, with
  // only a console warning to show for it.
  const { registered, pending } = mount({ deferInject: true })

  assert.equal(registered.has('documentPreviews|jupyter-notebook'), false)
  assert.equal(registered.has('sidebar.right.tab.document|jupyter-notebook'), false)
  // The tool card does not depend on the preview package, so it loads anyway.
  assert.equal(registered.has('tool.call.toolview|read_notebook'), true)
  assert.equal(pending.length, 1)

  // The registry arrives later; the preview registers without a restart.
  pending[0]()
  assert.equal(registered.get('documentPreviews|jupyter-notebook').definition.extensions[0], 'ipynb')
  assert.equal(registered.has('sidebar.right.tab.document|jupyter-notebook'), true)
})

test('a deployment whose preview service never arrives keeps the tool card', () => {
  const { registered, pending } = mount({ registryAvailable: false, deferInject: true })
  assert.equal(registered.has('tool.call.toolview|read_notebook'), true)
  assert.equal(pending.length, 1)
  pending[0]()
  assert.equal(registered.has('sidebar.right.tab.document|jupyter-notebook'), false)
  assert.equal(registered.has('documentPreviews|jupyter-notebook'), false)
})

test('the preview body renders markdown, code, outputs and a sandboxed HTML frame', () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })

  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.match(markdown[0].props.text, /# Demo notebook/)

  // The sample's cells record their run times, so the gutter shows them. Asserted on
  // the notebook a reader is most likely to open, not only on the assets fixture.
  const sampleText2 = collectStrings(tree).join('\n')
  for (const shown of ['300 ms', '1.2 s', '2.8 s', '12.4 s', '640 ms', '95 ms']) {
    assert.equal(sampleText2.includes(shown), true, `the run time ${shown} is shown`)
  }

  const code = findAll(tree, (node) => node.type === 'CodeBlock')
  assert.equal(code.length, 6)
  assert.match(code[0].props.code, /print\('hello'\)/)

  const images = findAll(tree, (node) => node.type === 'img')
  assert.equal(images.length, 1)
  assert.match(images[0].props.src, /^data:image\/png;base64,/)

  const frames = findAll(tree, (node) => node.type === 'iframe')
  assert.equal(frames.length, 1)
  // Read access for measurement, without script execution inside the frame.
  assert.equal(frames[0].props.sandbox, 'allow-same-origin')
  assert.match(frames[0].props.srcDoc, /<table/)

  const json = findAll(tree, (node) => node.type === 'JsonTree')
  assert.equal(json.length, 1)
  assert.deepEqual(json[0].props.data, { ok: true, items: [1, 2] })

  const pre = findAll(tree, (node) => node.type === 'pre')
  const text = pre.map((node) => String(node.props.children)).join('\n')
  assert.match(text, /hello from stdout/)
  assert.match(text, /ValueError: boom/)
})

test('the preview body reports a malformed notebook instead of dumping it', () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode('{ not json') },
    wrap: false,
    scrollportRef: () => {}
  })
  const text = findAll(tree, (node) => typeof node.props?.children === 'string')
    .map((node) => node.props.children)
    .join('\n')
  assert.match(text, /could not be rendered/)
  assert.match(text, /not valid JSON/)
  assert.equal(text.includes('{ not json'), false)
})

test('the preview body shows a pending state before the bytes arrive', () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, { content: { kind: 'renderer' }, wrap: false, scrollportRef: () => {} })
  const text = findAll(tree, (node) => typeof node.props?.children === 'string')
    .map((node) => node.props.children)
    .join('\n')
  assert.match(text, /incomplete/)
})

test('the tool card renders the digest without offering an unusable open action', () => {
  const { registered } = mount()
  const Card = registered.get('tool.call.toolview|read_notebook').component
  const opened = []
  const digest = { v: 1, language: 'python', kernel: 'python3', cellCount: 2, truncated: false, cells: [
    { i: 1, kind: 'markdown', source: '# Title' },
    { i: 2, kind: 'code', exec: 1, source: 'print(1)', outputs: [{ kind: 'stream', name: 'stdout', text: '1\n' }] }
  ] }

  const tree = rendered(Card, {
    phase: 'result',
    block: { isError: false, meta: digest, content: [] },
    openFile: (path) => opened.push(path)
  })

  assert.equal(findAll(tree, (node) => node.type === 'MarkdownText').length, 1)
  assert.equal(findAll(tree, (node) => node.type === 'CodeBlock').length, 1)
  assert.equal(findAll(tree, (node) => node.type === 'pre').length, 1)
  // The call carried no arguments, so there is no path to open and no open action.
  assert.equal(collectStrings(tree).join('\n').includes('Open in preview'), false)
  assert.deepEqual(opened, [])
})

test('markdown and code cells carry the label props the shipped primitives require', () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })

  // The shipped MarkdownText dereferences labels.code.copyLabel, so a missing
  // object there is a render crash, not a cosmetic default.
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.equal(typeof markdown[0].props.labels.code.copyLabel, 'string')
  assert.equal(markdown[0].props.labels.code.copyLabel.length > 0, true)
  assert.equal(typeof markdown[0].props.labels.footnotes, 'string')

  // CodeBlock's banner renders copyLabel/copiedLabel as its button children.
  const code = findAll(tree, (node) => node.type === 'CodeBlock')
  assert.equal(code.length, 6)
  for (const block of code) {
    assert.equal(block.props.lineNumbers, true)
    assert.equal(block.props.copyLabel.length > 0, true)
    assert.equal(block.props.copiedLabel.length > 0, true)
  }
})

test('every label object a deployed atom dereferences is complete', () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })

  // JsonTree is reached by the fixture's application/json output; the stub above
  // throws on a missing key, so finding it here means the contract was complete.
  const json = findAll(tree, (node) => node.type === 'JsonTree')
  assert.equal(json.length, 1)
  assert.deepEqual(json[0].props.data, { ok: true, items: [1, 2] })
  const labels = json[0].props.labels
  assert.equal(labels.expandNode.length > 0, true)
  assert.equal(labels.collapseNode.length > 0, true)
  assert.equal(labels.copyButtonTitle('Copy value'), 'Copy: Copy value')
  assert.equal(typeof labels.copied, 'string')
})

/** Every style object in a rendered tree, flattened for assertions. */
function collectStyles(tree) {
  const styles = []
  walk(tree, (node) => {
    if (node.props !== undefined && node.props !== null && typeof node.props.style === 'object' && node.props.style !== null) {
      styles.push(node.props.style)
    }
  })
  return styles
}

/** Every string child in a rendered tree. */
/**
 * Every string in a rendered tree, in document order.
 *
 * Collected by walking children directly rather than through `walk`: a node whose
 * children mix elements and strings (`[span, '\nValueError: boom']`, which is what
 * the ANSI-span path produces) would otherwise lose the bare string, and a joined
 * assertion would silently compare against less text than it claims to.
 */
function collectStrings(tree) {
  const strings = []
  const visit = (node) => {
    if (typeof node === 'string') {
      strings.push(node)
      return
    }
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    visit(node.props?.children)
  }
  visit(tree)
  return strings
}

const renderSampleBody = () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  return rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })
}

test('image outputs are never stretched or upscaled', () => {
  // Regression: the fixture's 1x1 PNG rendered as a full-width square, because a
  // flex-column parent stretches its items and only `maxWidth` was set.
  const images = findAll(renderSampleBody(), (node) => node.type === 'img')
  assert.equal(images.length, 1)
  const style = images[0].props.style
  assert.equal(style.alignSelf, 'flex-start')
  assert.equal(style.width, 'auto')
  assert.equal(style.height, 'auto')
  assert.equal(style.maxWidth, '100%')
  assert.equal(typeof style.maxHeight, 'string')
})

test('one error output prints its exception exactly once', () => {
  // Regression: the head `name: value` was prepended even though the traceback
  // already ends with that same line. Scoped to the error block, because a colored
  // traceback now renders as several runs and the outline also names the cell.
  const tree = renderSampleBody()
  const errorPre = findAll(
    tree,
    (node) => node.type === 'pre' && collectStrings(node).join('').includes('ValueError: boom')
  )
  assert.equal(errorPre.length, 1)
  const text = collectStrings(errorPre[0]).join('')
  const occurrences = text.split('ValueError: boom').length - 1
  assert.equal(occurrences, 1)
  assert.match(text, /ValueError: boom$/)
  // The traceback's own frame colors survive instead of one flat red block.
  assert.equal(findAll(errorPre[0], (node) => node.type === 'span').length > 0, true)
})

test('an HTML output is script-free, measurable, and typed like a table', () => {
  const tree = renderSampleBody()
  const frames = findAll(tree, (node) => node.type === 'iframe')
  assert.equal(frames.length, 1)
  const props = frames[0].props
  // Scripts stay disabled; same-origin read access is what lets the frame size
  // itself to its content instead of holding a fixed, mostly empty slab.
  assert.equal(props.sandbox, 'allow-same-origin')
  assert.equal(props.srcDoc.includes('allow-scripts'), false)
  assert.equal(typeof props.onLoad, 'function', 'the frame measures itself on load')
  // Before the load event there is a small first-paint height, not a tall one.
  assert.equal(props.style.height, 120)
  // The injected sheet styles every table as a data table: a bold header, row
  // separators and zebra rows instead of a full grid.
  assert.match(props.srcDoc, /<style>/)
  assert.match(props.srcDoc, /th,td\{padding:6px 12px[^}]*border:0;border-bottom:1px solid /)
  assert.match(props.srcDoc, /thead th\{font-weight:600;border-bottom:1px solid /)
  assert.match(props.srcDoc, /tbody th\{font-weight:600\}/)
  assert.match(props.srcDoc, /tbody tr:nth-child\(even\) td,tbody tr:nth-child\(even\) th\{background:/)
  assert.equal(props.srcDoc.includes(':not(.dataframe)'), false, 'one table style covers pandas and hand-written tables')
  // An interpolated missing value would emit `solid undefined` and drop the whole
  // declaration, which is how the first version of this sheet lost its borders.
  assert.equal(props.srcDoc.includes('undefined'), false)
  // No expand control unless the measured content was clamped. Asserted by label:
  // every text output now also carries a copy control.
  assert.equal(findAll(tree, (node) => node.type === 'button' && collectStrings(node).join(' ').includes('Show more')).length, 0)
})

test('a real pandas table gets row separators, not a grid', () => {
  // The fixture's HTML is a faithful `to_html()` table: `border="1"` is only a
  // presentational hint, so the author rules above must win and remove the grid.
  const frames = findAll(renderSampleBody(), (node) => node.type === 'iframe')
  assert.match(frames[0].props.srcDoc, /class="dataframe"/)
  assert.match(frames[0].props.srcDoc, /<thead>/)
  assert.match(frames[0].props.srcDoc, /<tbody>/)
})

test('a table without a dataframe class is styled the same way', () => {
  const tree = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'plain',
        outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<table><tr><th>a</th></tr><tr><td>1</td></tr></table>' } }]
      }
    ])
  )
  const frames = findAll(tree, (node) => node.type === 'iframe')
  assert.equal(frames.length, 1)
  assert.match(frames[0].props.srcDoc, /<table><tr><th>a<\/th><\/tr>/)
  assert.match(frames[0].props.srcDoc, /th,td\{padding:6px 12px[^}]*border-bottom:1px solid /)
})

test('a table output drops the container frame; other HTML keeps it', () => {
  // The frame delimits an output widget, but a table already draws its own row
  // separators, so a second box around it looked like a leftover.
  const tableFrame = findAll(renderSampleBody(), (node) => node.type === 'iframe')[0]
  assert.equal(tableFrame.props.style.border, 'none')
  assert.equal(tableFrame.props.style.background, 'transparent')
  assert.equal(tableFrame.props.style.borderRadius, '6px', 'the rest of the frame style is inherited')

  const other = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'html',
        outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': '<div><b>plain</b> markup</div>' } }]
      }
    ])
  )
  const otherFrame = findAll(other, (node) => node.type === 'iframe')[0]
  assert.equal(otherFrame.props.style.border, '1px solid var(--dsw-alias-border-l1)')
  assert.equal(otherFrame.props.style.background, 'var(--dsw-alias-bg-layer-1)')
})

test('a scoped stylesheet strengthens the code surface without touching the app', () => {
  const tree = renderSampleBody()
  const sheets = findAll(tree, (node) => node.type === 'style')
  assert.equal(sheets.length, 1)
  const css = String(sheets[0].props.children)
  // Every selector is prefixed, and the atoms' stable hooks are what is targeted.
  for (const rule of css.split('}').filter((part) => part.trim().length > 0)) {
    assert.match(rule.trim(), /^\.dsh-jupyter /, `unscoped selector in: ${rule}`)
  }
  assert.match(css, /\.dsh-jupyter \.md-code-block\{background:color-mix\(in srgb, currentColor \d+%, transparent\)/)
  assert.match(css, /\[data-code-block-banner\]/)
  // The surface is derived, not read from a variable: those are not reliably
  // visible from this subtree, and the theme's layer surfaces are too close to the
  // page in light mode — which is what read as washed out.
  assert.equal(css.includes('var(--dsw-'), false)
  const tint = Number(/currentColor (\d+)%, transparent/.exec(css)[1])
  assert.equal(tint >= 8, true, `the surface tint (${tint}%) must actually separate the card from the page`)
  // The pane that carries the class is the one the rules apply to.
  const roots = findAll(tree, (node) => node.props?.className === 'dsh-jupyter')
  assert.equal(roots.length > 0, true)
})

test('cells use a Jupyter prompt gutter instead of uppercase type tags', () => {
  const strings = collectStrings(renderSampleBody())
  assert.equal(strings.includes('In [1]'), true)
  assert.equal(strings.includes('In [ ]'), true, 'an unexecuted cell shows an empty prompt')
  assert.equal(strings.includes('Raw'), true)
  assert.equal(
    strings.some((value) => /MARKDOWN|Markdown|代码|^Code$/.test(value)),
    false,
    'no per-cell type tag remains'
  )
})

test('every color comes from the theme, except the terminal palette', () => {
  const flat = JSON.stringify(collectStyles(renderSampleBody()))
  assert.match(flat, /var\(--dsw-alias-label-primary\)/)
  assert.match(flat, /var\(--dsw-alias-state-error-primary\)/)
  assert.equal(/rgba\(127,127,127/.test(flat), false, 'the old neutral grey is gone')
  // A terminal's colors are a fixed standard, not theme tokens, so the SGR palette
  // is the one place a literal is legitimate.
  const allowed = new Set(Object.values(ANSI_PALETTE).filter((value) => value.startsWith('#')))
  for (const hex of flat.match(/#[0-9a-fA-F]{6}/g) ?? []) {
    assert.equal(allowed.has(hex), true, `unexpected color literal ${hex}`)
  }
})

test('stderr keeps the neutral surface and only tints its text', () => {
  const tree = renderSampleBody()
  const stderr = findAll(tree, (node) => node.type === 'pre' && node.props.title === 'stderr')
  assert.equal(stderr.length, 1)
  assert.equal(stderr[0].props.style.color, 'var(--dsw-alias-state-warn-primary)')
  // It is a stream, not a failure: the error surface must not be reused.
  assert.equal(JSON.stringify(stderr[0].props.style).includes('state-error-primary'), false)
})

test('captured ANSI colors survive into styled runs', () => {
  // The fixture's stderr is `\u001b[31m…\u001b[0m`, so the run carries the SGR color
  // instead of the text being flattened to plain. Matched on the run's own text,
  // since the fixture's traceback is red as well.
  const tree = renderSampleBody()
  const red = findAll(
    tree,
    (node) => node.type === 'span' && node.props.children === 'warning: red text'
  )
  assert.equal(red.length, 1)
  assert.equal(red[0].props.style.color, ANSI_PALETTE[31])
  assert.equal(collectStrings(tree).some((value) => value.includes('\u001B')), false, 'escapes never reach the DOM text')
})

test('a text/markdown output is rendered as markdown, not as its source', () => {
  const tree = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'md',
        outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': '## Heading\n\n- item' } }]
      }
    ])
  )
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.equal(markdown[0].props.text, '## Heading\n\n- item', 'no delimiters are added')
  assert.equal(findAll(tree, (node) => node.type === 'pre').length, 0, 'and not shown as source')
})

test('an image alt names the image, not the HTML output', () => {
  const images = findAll(renderSampleBody(), (node) => node.type === 'img')
  assert.equal(images[0].props.alt, 'Image output')
})

/** A one-cell notebook, for exercising outputs the sample fixture does not carry. */
const inlineNotebook = (cells) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells })

const renderInline = (notebook, extraProps = {}) => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  return rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(notebook) },
    wrap: false,
    scrollportRef: () => {},
    ...extraProps
  })
}

/** The same body, but with click handlers that can be replayed. */
const interactiveInline = (notebook, extraProps = {}) => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  return interactive(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(notebook) },
    wrap: false,
    scrollportRef: () => {},
    ...extraProps
  })
}

/** The same body over the sample fixture, with click handlers. */
const interactiveSample = () => {
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  return interactive(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })
}

test('clicking controls actually changes the view', () => {
  // These behaviours are all state-driven: before this suite could replay state,
  // they were only ever asserted as "the control exists".
  const lines = Array.from({ length: 60 }, (_, at) => `line ${at}`).join('\n')
  const long = interactiveInline(
    inlineNotebook([
      { cell_type: 'code', execution_count: 1, metadata: {}, source: 'print()', outputs: [{ output_type: 'stream', name: 'stdout', text: lines }] }
    ])
  )
  const pre = () => findAll(long.tree, (node) => node.type === 'pre')[0]
  assert.equal(pre().props.style.maxHeight, '320px', 'starts capped')
  long.clickLabel('Show all')
  assert.equal(pre().props.style.maxHeight, undefined, 'expanded')
  assert.match(long.text(), /Collapse/)
  long.clickLabel('Collapse')
  assert.equal(pre().props.style.maxHeight, '320px', 'collapsed again')

  // A collapsed output stays hidden until asked for.
  const collapsed = interactiveInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: { collapsed: true },
        source: 'log()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'hidden\n' }]
      }
    ])
  )
  assert.equal(findAll(collapsed.tree, (node) => node.type === 'pre').length, 0, 'hidden at first')
  collapsed.clickLabel('Show output')
  assert.equal(findAll(collapsed.tree, (node) => node.type === 'pre').length, 1, 'revealed')
  assert.match(collapsed.text(), /hidden/)
  assert.match(collapsed.text(), /Hide output/)

  // The raw view replaces the rendering, and comes back.
  const sample = interactiveSample()
  assert.equal(findAll(sample.tree, (node) => node.type === 'CodeBlock').length > 0, true)
  sample.clickLabel('View raw JSON')
  const raw = findAll(sample.tree, (node) => node.type === 'pre')
  assert.equal(raw.length, 1)
  assert.equal(raw[0].props.children, sampleText, 'the file exactly as saved')
  assert.equal(findAll(sample.tree, (node) => node.type === 'CodeBlock').length, 0, 'the rendering is gone')
  assert.match(sample.text(), /Back to rendered/)
  sample.clickLabel('Back to rendered')
  assert.equal(findAll(sample.tree, (node) => node.type === 'CodeBlock').length > 0, true, 'rendered again')
})

test('showing all cells renders the cells the cap left out', () => {
  const cells = Array.from({ length: LIMITS.previewMaxCells + 5 }, (_, at) => ({
    cell_type: 'markdown',
    metadata: {},
    source: `cell ${at + 1}`
  }))
  const view = interactiveInline(inlineNotebook(cells))
  assert.equal(findAll(view.tree, (node) => node.type === 'MarkdownText').length, LIMITS.previewMaxCells)
  view.clickLabel('Show all cells')
  assert.equal(findAll(view.tree, (node) => node.type === 'MarkdownText').length, cells.length)
})

test('a long output collapses behind a control, a short one does not', () => {
  const lines = Array.from({ length: 60 }, (_, at) => `line ${at}`).join('\n')
  const long = renderInline(
    inlineNotebook([
      { cell_type: 'code', execution_count: 1, metadata: {}, source: 'print()', outputs: [{ output_type: 'stream', name: 'stdout', text: lines }] }
    ])
  )
  const longPre = findAll(long, (node) => node.type === 'pre')
  assert.equal(longPre.length, 1)
  assert.equal(longPre[0].props.style.maxHeight, '320px')
  const buttons = findAll(long, (node) => node.type === 'button' || node.type === 'Button')
  const expand = buttons.filter((node) => collectStrings(node).join(' ').includes('Show all'))
  assert.equal(expand.length, 1)
  assert.match(String(expand[0].props.children), /60/)
  // The copy control sits beside the expand control.
  const copy = buttons.filter((node) => collectStrings(node).join(' ').includes('Copy'))
  assert.equal(copy.length, 1)

  // The sample's outputs are all short, so nothing collapses; the HTML frame only
  // offers a control once its own measurement reports clamped content, which needs
  // a browser.
  const sampleTree = renderSampleBody()
  for (const pre of findAll(sampleTree, (node) => node.type === 'pre')) {
    assert.equal(pre.props.style.maxHeight, undefined)
  }
  assert.equal(
    findAll(
      sampleTree,
      (node) => (node.type === 'button' || node.type === 'Button') && collectStrings(node).join(' ').includes('Show all')
    ).length,
    0
  )
})

test('a text/latex output is typeset as math instead of printed', () => {
  const tree = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'sym',
        outputs: [{ output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/latex': '\\frac{a}{b}' } }]
      }
    ])
  )
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.match(markdown[0].props.text, /^\$\$\n/)
  assert.match(markdown[0].props.text, /\\frac\{a\}\{b\}/)
  assert.equal(findAll(tree, (node) => node.type === 'pre').length, 0)
})

test('a relative markdown image resolves through the authenticated file route', () => {
  const previousDocument = globalThis.document
  globalThis.document = { baseURI: 'http://127.0.0.1:19999/' }
  try {
    const tree = renderInline(
      inlineNotebook([
        {
          cell_type: 'markdown',
          metadata: {},
          source: '![fig](figs/a.png?x=1#y)\n\n![remote](https://example.com/b.png)\n\n![abs](/abs/b.png)\n\n![escaped](fig%2Fb.png)'
        }
      ]),
      {
        resourceAddress: 'dsh-resource://file/session/s1/test/fixtures/demo.ipynb',
        useResource: () => ({ status: 'ready', value: { absolutePath: '/work/test/fixtures/demo.ipynb' } })
      }
    )
    const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
    assert.equal(markdown.length, 1)
    const { resolve } = markdown[0].props.pathImages
    assert.equal(typeof resolve, 'function')
    // A relative destination joins the notebook's own directory, and a query or
    // fragment never reaches the file route.
    assert.equal(resolve('figs/a.png?x=1#y'), 'http://127.0.0.1:19999/api/file?path=%2Fwork%2Ftest%2Ffixtures%2Ffigs%2Fa.png')
    assert.equal(resolve('/abs/b.png'), 'http://127.0.0.1:19999/api/file?path=%2Fabs%2Fb.png')
    assert.equal(resolve('fig%2Fb.png'), 'http://127.0.0.1:19999/api/file?path=%2Fwork%2Ftest%2Ffixtures%2Ffig%2Fb.png')
    // A real scheme is the atom's business, not this resolver's.
    assert.equal(resolve('https://example.com/b.png'), undefined)
    assert.equal(resolve(''), undefined)
    assert.equal(resolve('%ZZ'), undefined)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('without a Host absolute path no relative image vocabulary is offered', () => {
  const tree = renderInline(inlineNotebook([{ cell_type: 'markdown', metadata: {}, source: '![fig](figs/a.png)' }]), {
    resourceAddress: 'dsh-resource://file/session/s1/demo.ipynb',
    useResource: () => ({ status: 'reading' })
  })
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.equal(markdown[0].props.pathImages, undefined)
})

test('an image is fitted, and offers its actual size only when fitting shrinks it', () => {
  const images = findAll(renderSampleBody(), (node) => node.type === 'img')
  assert.equal(images.length, 1)
  const props = images[0].props
  // Fitted and never enlarged.
  assert.equal(props.style.maxWidth, '100%')
  assert.equal(props.style.alignSelf, 'flex-start')
  assert.equal(props.style.width, 'auto')
  // The pane width is read on load; until then no control is promised, because a
  // figure smaller than the pane renders identically either way.
  assert.equal(typeof props.onLoad, 'function')
  assert.equal(props.style.cursor, 'default')
  assert.equal(props.onClick, undefined)
  assert.equal(props.title, undefined)
})

test('a missing atom is named instead of silently rendering as source', () => {
  // Silent degradation is what made "markdown did not render" indistinguishable
  // from "markdown rendered as its own source".
  const { registered } = mount({ primitiveOverrides: { MarkdownText: undefined } })
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })
  const text = collectStrings(tree).join('\n')
  assert.match(text, /does not expose MarkdownText/)
  assert.equal(findAll(tree, (node) => node.type === 'MarkdownText').length, 0)
})

test('a memoized atom is rendered, not mistaken for a missing one', () => {
  // Regression: `typeof memoComponent === 'object'`, so a `typeof === 'function'`
  // guard silently disabled MarkdownText — the shipped one is `memo(...)`.
  const memoMarkdown = {
    $$typeof: Symbol.for('react.memo'),
    type: (props) => ({ type: 'MarkdownText', props })
  }
  const { registered } = mount({ primitiveOverrides: { MarkdownText: memoMarkdown } })
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })
  // The memo object is handed to createElement, which the stub renders through.
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.equal(collectStrings(tree).join('\n').includes('does not expose MarkdownText'), false)
})

test('a cell attachment resolves without a Host path, in the card too', () => {
  // An `attachment:` image is embedded in the cell, so it needs neither the
  // document's absolute path nor a file read — which is why the chat card, which
  // has no path at all, can still show it.
  const tree = renderInline(
    inlineNotebook([
      {
        cell_type: 'markdown',
        metadata: {},
        source: '![x](attachment:a.png)',
        attachments: { 'a.png': { 'image/png': 'QUJD' } }
      }
    ])
  )
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.equal(markdown[0].props.pathImages.resolve('attachment:a.png'), 'data:image/png;base64,QUJD')
  // Without a Host path, anything else stays inert.
  assert.equal(markdown[0].props.pathImages.resolve('figs/a.png'), undefined)
})

test('a relative asset inside an HTML output is addressed through the file route', () => {
  const previousDocument = globalThis.document
  globalThis.document = { baseURI: 'http://127.0.0.1:19999/' }
  try {
    const markup = '<div>'
      + '<img src="figs/a.png">'
      + "<img src='figs/b.png'>"
      + '<a href="notes/c.md">c</a>'
      + '<img src="https://example.com/d.png">'
      + '<img src="data:image/png;base64,QUJD">'
      + '<img src="/absolute/e.png">'
      + '<img srcset="figs/a.png 1x, figs/b.png 2x" src="figs/a.png">'
      + '<div style="background-image:url(figs/d.png)">d</div>'
      + '<p>the string url(figs/e.png) written as prose stays put</p>'
      + '</div>'
    const tree = renderInline(
      inlineNotebook([
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          source: 'html',
          outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': markup } }]
        }
      ]),
      {
        resourceAddress: 'dsh-resource://file/session/s1/nb/demo.ipynb',
        useResource: () => ({ status: 'ready', value: { absolutePath: '/work/nb/demo.ipynb' } })
      }
    )
    const src = findAll(tree, (node) => node.type === 'iframe')[0].props.srcDoc
    const media = (path) => `http://127.0.0.1:19999/api/file?path=${encodeURIComponent(path)}`
    // A `srcDoc` document resolves relative URLs against the host page, so these
    // would 404 without the rewrite — in both quoting styles.
    assert.equal(src.includes(`src="${media('/work/nb/figs/a.png')}"`), true)
    assert.equal(src.includes(`src="${media('/work/nb/figs/b.png')}"`), true)
    assert.equal(src.includes(`href="${media('/work/nb/notes/c.md')}"`), true)
    assert.equal(src.includes(`src="${media('/absolute/e.png')}"`), true)
    // A `srcset` candidate list keeps each descriptor.
    assert.equal(
      src.includes(`srcset="${media('/work/nb/figs/a.png')} 1x, ${media('/work/nb/figs/b.png')} 2x"`),
      true
    )
    // A `url()` inside a style attribute is addressable. The inner quotes are HTML
    // escapes, because the whole attribute value is re-quoted.
    assert.equal(src.includes(`background-image:url(&quot;${media('/work/nb/figs/d.png')}&quot;)`), true)
    assert.equal(src.includes('url(figs/e.png) written as prose'), true)
    // Everything the resolver cannot address keeps its authored value.
    assert.equal(src.includes('src="https://example.com/d.png"'), true)
    assert.equal(src.includes('src="data:image/png;base64,QUJD"'), true)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('the assets fixture exercises every reference feature it claims to', () => {
  // A feature that no fixture carries cannot be verified by looking at the app, so
  // the fixture is asserted here rather than trusted.
  const fixture = readFileSync(fileURLToPath(new URL('./fixtures/assets.ipynb', import.meta.url)), 'utf8')
  const notebook = JSON.parse(fixture)
  assert.equal(notebook.cells.length, 9)
  const [attached, relative, html, progress, ansi, markdown, collapsed, tagged, hidden] = notebook.cells
  assert.equal(Object.keys(attached.attachments).length, 1)
  assert.match(attached.source.join(''), /attachment:inline\.png/)
  assert.match(relative.source.join(''), /\(sample-figure\.png\)/)
  assert.match(html.outputs[0].data['text/html'], /src="sample-figure\.png"/)
  assert.match(progress.outputs[0].text, /\r/)
  assert.match(ansi.outputs[0].text, /\u001B\[/)
  assert.match(markdown.outputs[0].data['text/markdown'], /^## /)
  assert.equal(collapsed.metadata.collapsed, true)
  assert.deepEqual(tagged.metadata.tags, ['parameters', 'papermill'])
  assert.equal(hidden.metadata.jupyter.outputs_hidden, true)
  // The progress cell also carries the timestamps the run time is read from.
  assert.equal(typeof progress.metadata.execution['shell.execute_reply'], 'string')
})
test('the assets fixture renders every feature it carries', () => {
  const previousDocument = globalThis.document
  globalThis.document = { baseURI: 'http://127.0.0.1:19999/' }
  try {
    const fixture = readFileSync(fileURLToPath(new URL('./fixtures/assets.ipynb', import.meta.url)), 'utf8')
    const tree = renderInline(fixture, {
      resourceAddress: 'dsh-resource://file/session/s1/test/fixtures/assets.ipynb',
      useResource: () => ({ status: 'ready', value: { absolutePath: '/work/test/fixtures/assets.ipynb' } })
    })
    const media = (path) => `http://127.0.0.1:19999/api/file?path=${encodeURIComponent(path)}`

    // 1 + 2 + 6: two markdown cells and one `text/markdown` output all reach the atom.
    const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
    assert.equal(markdown.length, 3)
    // 1. an embedded attachment needs no Host path
    assert.equal(markdown[0].props.pathImages.resolve('attachment:inline.png').startsWith('data:image/png;base64,'), true)
    // 2. a relative markdown image joins the notebook's directory
    assert.equal(markdown[1].props.pathImages.resolve('sample-figure.png'), media('/work/test/fixtures/sample-figure.png'))
    // 6. the markdown output is rendered rather than printed
    assert.match(markdown[2].props.text, /^## Rendered markdown output/)

    // 3. the HTML output's relative asset is pointed at the file route
    const frames = findAll(tree, (node) => node.type === 'iframe')
    assert.equal(frames.length, 1)
    assert.equal(frames[0].props.srcDoc.includes(`src="${media('/work/test/fixtures/sample-figure.png')}"`), true)

    // 4. the progress bar shows its last frame only. Asserted exactly rather than by
    // substring: `'100%|…'.includes('0%|')` is true, which is how a fuzzy check
    // reported the final frame as an earlier one.
    const progress = findAll(
      tree,
      (node) => node.type === 'pre' && typeof node.props.children === 'string' && node.props.children.includes('done')
    )
    assert.equal(progress.length, 1)
    assert.equal(progress[0].props.children, '100%|##########| 50/50\ndone\n')

    // 7. the run time the notebook recorded, read from real Jupyter timestamps
    assert.match(collectStrings(tree).join('\n'), /12\.4 s/, 'the recorded run time is shown')
    assert.equal(findAll(tree, (node) => node.props?.title === 'This cell’s run time').length, 1)

    // 5. ANSI runs are styled, stacked attributes included
    const green = findAll(tree, (node) => node.type === 'span' && node.props.style?.color === ANSI_PALETTE[32])
    assert.equal(green.length, 1)
    assert.equal(green[0].props.children, 'PASS')
    const boldRed = findAll(
      tree,
      (node) => node.type === 'span' && node.props.style?.color === ANSI_PALETTE[31] && node.props.style?.fontWeight === 600
    )
    assert.equal(boldRed.length, 1)
    assert.equal(boldRed[0].props.children, 'FAIL')
    const underlined = findAll(tree, (node) => node.type === 'span' && node.props.style?.textDecoration === 'underline')
    assert.equal(underlined.length, 1)
    assert.equal(collectStrings(tree).some((value) => value.includes('\u001B')), false)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('an output a notebook saved collapsed opens behind a control', () => {
  const collapsed = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: { collapsed: true },
        source: 'log()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'a\nb\n' }]
      }
    ])
  )
  assert.match(collectStrings(collapsed).join('\n'), /Show output/)
  assert.equal(findAll(collapsed, (node) => node.type === 'pre').length, 0, 'the output stays hidden until asked for')
  assert.equal(
    findAll(
      collapsed,
      (node) => (node.type === 'button' || node.type === 'Button') && collectStrings(node).join(' ').includes('Show output')
    ).length,
    1
  )

  const plain = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'log()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'a\nb\n' }]
      }
    ])
  )
  assert.equal(findAll(plain, (node) => node.type === 'pre').length, 1, 'a normal cell shows its output')
  assert.equal(
    findAll(
      plain,
      (node) => (node.type === 'button' || node.type === 'Button') && collectStrings(node).join(' ').includes('Show output')
    ).length,
    0
  )
})

test('cell tags render as the product’s own pills', () => {
  // Tags are how a toolchain records what a cell is for — papermill's `parameters`,
  // nbconvert's `remove_cell` — so hiding them hides information on purpose.
  const tree = renderInline(
    inlineNotebook([
      { cell_type: 'code', execution_count: 1, metadata: { tags: ['parameters', 'papermill'] }, source: 'x', outputs: [] },
      { cell_type: 'markdown', metadata: { tags: ['remove_cell'] }, source: '# h' },
      { cell_type: 'code', execution_count: 2, metadata: {}, source: 'y', outputs: [] }
    ])
  )
  const pills = findAll(tree, (node) => node.type === 'Pill')
  assert.deepEqual(pills.map((pill) => pill.props.children), ['parameters', 'papermill', 'remove_cell'])
})

test('Jupyter hidden metadata shows a note instead of an empty-looking cell', () => {
  const sourceHidden = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: { jupyter: { source_hidden: true } },
        source: 'secret()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'out\n' }]
      }
    ])
  )
  assert.equal(findAll(sourceHidden, (node) => node.type === 'CodeBlock').length, 0)
  assert.match(collectStrings(sourceHidden).join('\n'), /Input hidden/)
  assert.equal(findAll(sourceHidden, (node) => node.type === 'pre').length, 1, 'the output is still shown')

  const outputsHidden = renderInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: { jupyter: { outputs_hidden: true } },
        source: 'x()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'out\n' }]
      }
    ])
  )
  assert.equal(findAll(outputsHidden, (node) => node.type === 'code' || node.type === 'pre').length, 0)
  assert.equal(findAll(outputsHidden, (node) => node.type === 'CodeBlock').length, 1)
  assert.match(collectStrings(outputsHidden).join('\n'), /Output hidden/)
})

test('a copy control hands the platform the right text', async () => {
  const before = clipboardWrites.length
  const tree = renderInline(
    inlineNotebook([
      { cell_type: 'markdown', metadata: {}, source: '# Title' },
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'print()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'out\n' }]
      }
    ])
  )
  // Controls are the product's own `Button`, which is a `forwardRef`. Filtered by
  // label, since the meta bar carries controls of its own.
  const buttons = findAll(
    tree,
    (node) =>
      (node.type === 'button' || node.type === 'Button') && collectStrings(node).join(' ').includes('Copy')
  )
  assert.equal(buttons.length, 2, 'one for the markdown source, one for the output')
  buttons[0].props.onClick()
  buttons[1].props.onClick()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(clipboardWrites.slice(before), ['# Title', 'out\n'])
})

test('controls degrade to a native button when the product has none', () => {
  const { registered } = mount({ primitiveOverrides: { Button: undefined, Pill: undefined } })
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: {
      kind: 'bytes',
      data: new TextEncoder().encode(
        inlineNotebook([
          {
            cell_type: 'code',
            execution_count: 1,
            metadata: { tags: ['t'] },
            source: 'x',
            outputs: [{ output_type: 'stream', name: 'stdout', text: 'a\nb\n' }]
          }
        ])
      )
    },
    wrap: false,
    scrollportRef: () => {}
  })
  assert.equal(findAll(tree, (node) => node.type === 'Button' || node.type === 'Pill').length, 0)
  assert.equal(findAll(tree, (node) => node.type === 'button').length > 0, true, 'a native control remains')
  assert.match(collectStrings(tree).join('\n'), /\bt\b/, 'the tag is still shown')
})

test('the navigation rail sits beside the notebook, sticky, and carries its own toggle', () => {
  const view = interactiveSample()
  // Exactly one toggle: the rail is visible in both states and stays put while the
  // notebook scrolls, so a second one in the meta bar would be a duplicate that
  // scrolls away.
  const toggles = findAll(
    view.tree,
    (node) => typeof node.props?.onClick === 'function' && /Contents/.test(collectStrings(node).join(' '))
  )
  assert.equal(toggles.length, 1, 'the rail owns the only contents toggle')
  // A table of contents that scrolls away has to be scrolled back to before it can be
  // used, which is most of its value gone: the rail is sticky in both states.
  const rail = () => findAll(view.tree, (node) => node.props?.style?.position === 'sticky' && node.props.style?.alignSelf === 'flex-start')[0]
  assert.notEqual(rail(), undefined)
  assert.equal(rail().props.style.top, 0)
  // Collapsed, it is still there — with the way to reopen it.
  assert.equal(collectStrings(rail()).join(' ').includes('Contents'), true, 'the collapsed strip can reopen it')
  assert.equal(findAll(view.tree, (node) => node.props?.role === 'navigation').length, 0)

  // Side by side with the notebook, and the notebook may not stretch the row.
  const workspace = findAll(view.tree, (node) => node.props?.style?.display === 'flex' && node.props.style?.gap === '12px')[0]
  assert.notEqual(workspace, undefined, 'the rail and the notebook share a flex row')
  assert.equal(workspace.props.style.alignItems, 'flex-start')
  const body = workspace.props.children[1]
  assert.equal(body.props.style.minWidth, 0)

  view.clickLabel('Contents')
  assert.notEqual(rail(), undefined, 'still sticky when open')
  assert.equal(rail().props.style.width, '190px')
})

test('the contents panel lists the notebook and jumps where it says', () => {
  const view = interactiveSample()
  // Collapsed until asked for: a table of contents that always covers the notebook is
  // worse than no table of contents.
  assert.equal(findAll(view.tree, (node) => node.props?.role === 'navigation').length, 0)
  assert.match(view.text(), /Contents/)

  view.clickLabel('Contents')
  assert.equal(findAll(view.tree, (node) => node.props?.role === 'navigation').length, 1)
  assert.match(view.text(), /Hide contents/, 'the control now offers to close it')
  // Code entries are one click away: the sample has a single heading, so without them
  // there would be nothing to jump to.
  view.clickLabel('Show code cells')

  const items = findAll(view.tree, (node) => node.type === 'button' && node.props?.title !== undefined)
  assert.equal(items.length > 5, true, 'every cell is reachable')
  // The markdown heading is an entry of its own, and code cells carry their prompt.
  assert.equal(items.some((item) => item.props.title === 'Demo notebook'), true)
  assert.equal(items.some((item) => String(item.props.title).startsWith('In [')), true)

  // Clicking an entry scrolls that cell into view — the point of the feature, and
  // something a `<select>` could not be checked for. The prompt counter is not the
  // cell's index, so the expected index comes from the notebook itself.
  const parsed = parseNotebook(sampleText).notebook
  const target = items.find((item) => String(item.props.title).startsWith('In [2] 6 * 7'))
  assert.notEqual(target, undefined)
  const expected = parsed.cells.find((cell) => cell.source.includes('6 * 7')).index
  target.props.onClick()
  view.rerender()
  assert.equal(view.scrolled.length, 1)
  assert.match(view.scrolled[0], new RegExp(`cell-${expected}$`))
})

test('the contents panel nests code cells under their heading, hidden by default', () => {
  const view = interactiveInline(
    inlineNotebook([
      { cell_type: 'markdown', metadata: {}, source: 'prose before anything\n\n# Top\n\n## Sub\n\n### Deep\n' },
      { cell_type: 'code', execution_count: 3, metadata: {}, source: '\n\n  indented()\n', outputs: [] }
    ])
  )
  view.clickLabel('Contents')
  const items = () => findAll(view.tree, (node) => node.type === 'button' && node.props?.title !== undefined)
  // Headings are the spine: a long list of code lines is what makes a contents list
  // unusable, so code entries are one click away rather than always listed.
  assert.deepEqual(items().map((item) => item.props.title), ['Top', 'Sub', 'Deep'])
  assert.deepEqual(items().map((item) => item.props.style.paddingLeft), ['6px', '18px', '30px'])
  // Headings are emphasised, and the toggle says which way it goes.
  assert.equal(items().every((item) => item.props.style.fontWeight === 600), true)
  assert.match(view.text(), /Show code cells/)

  view.clickLabel('Show code cells')
  assert.deepEqual(items().map((item) => item.props.title), ['Top', 'Sub', 'Deep', 'In [3] indented()'])
  // The code cell belongs to `### Deep`, so it sits one level deeper than it.
  assert.equal(items()[3].props.style.paddingLeft, '42px')
  assert.equal(items()[3].props.style.fontWeight, undefined)
  assert.match(view.text(), /Hide code cells/)

  // A notebook without headings keeps its cells, because they are all there is.
  const prose = interactiveInline(
    inlineNotebook([{ cell_type: 'markdown', metadata: {}, source: 'Just prose.\n' }, { cell_type: 'markdown', metadata: {}, source: 'More prose.\n' }])
  )
  prose.clickLabel('Contents')
  const proseItems = findAll(prose.tree, (node) => node.type === 'button' && node.props?.title !== undefined)
  assert.deepEqual(proseItems.map((item) => item.props.title), ['Just prose.', 'More prose.'])
  assert.equal(prose.text().includes('Show code cells'), false, 'there is nothing to nest under')
})

test('a markdown cell hidden by metadata shows a note instead of its prose', () => {
  const tree = renderInline(
    inlineNotebook([
      { cell_type: 'markdown', metadata: { jupyter: { source_hidden: true } }, source: '# Hidden prose' },
      { cell_type: 'markdown', metadata: {}, source: '# Shown prose' }
    ])
  )
  assert.equal(findAll(tree, (node) => node.type === 'MarkdownText').length, 1)
  assert.equal(findAll(tree, (node) => node.type === 'MarkdownText')[0].props.text, '# Shown prose')
  assert.match(collectStrings(tree).join('\n'), /Input hidden/)
})

test('a scrolled output opens capped even when it is short', () => {
  const cells = (metadata) => [
    {
      cell_type: 'code',
      execution_count: 1,
      metadata,
      source: 'x()',
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'one\ntwo\n' }]
    }
  ]
  const scrolled = renderInline(inlineNotebook(cells({ scrolled: true })))
  assert.equal(findAll(scrolled, (node) => node.type === 'pre')[0].props.style.maxHeight, '320px')
  const plain = renderInline(inlineNotebook(cells({})))
  assert.equal(findAll(plain, (node) => node.type === 'pre')[0].props.style.maxHeight, undefined)
})

test('the body does not hijack the preview owner’s scrollport', () => {
  // `scrollportRef` is "report a renderer-owned scrollport". This body owns none: the
  // owner's own body element scrolls, and it is what the owner saves and restores
  // `scrollTop` on. Attaching the ref here made restoration target an element whose
  // `scrollTop` is always 0. An internal ref of the body's own is fine — the owner's
  // must never be called.
  const calls = []
  const { registered } = mount()
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: (element) => calls.push(element)
  })
  assert.deepEqual(calls, [], 'the owner’s scrollportRef is never invoked')
  const root = findAll(tree, (node) => node.props?.className === 'dsh-jupyter')[0]
  assert.notEqual(root, undefined)
  assert.equal(typeof root.props.ref, 'object', 'the body keeps its own object ref')
  assert.notEqual(root.props.ref, undefined)
})

test('a colored traceback and its plain text agree line for line', () => {
  // Regression: the colored path rendered the raw traceback, so a traceback that does
  // not end with `Name: value` lost the head the plain path adds.
  const notebook = inlineNotebook([
    {
      cell_type: 'code',
      execution_count: 1,
      metadata: {},
      source: 'boom()',
      outputs: [
        {
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'boom',
          traceback: ['\u001b[31mframes here\u001b[0m']
        }
      ]
    }
  ])
  const tree = renderInline(notebook)
  const pre = findAll(
    tree,
    (node) => node.type === 'pre' && collectStrings(node).join('').includes('ValueError: boom')
  )
  assert.equal(pre.length, 1)
  const joined = collectStrings(pre[0]).join('')
  assert.match(joined, /ValueError: boom/)
  assert.match(joined, /frames here/)
  // The colored run carries the frame color, and the appended head is present too.
  assert.equal(findAll(pre[0], (node) => node.type === 'span' && node.props.style?.color === ANSI_PALETTE[31]).length, 1)
})

test('finding text marks the matching cells and steps through them', () => {
  const parsed = parseNotebook(sampleText).notebook
  const one = findCells(parsed.cells, 'print')
  assert.equal(one.length, 1, 'the fixture has one cell mentioning print')

  const view = interactiveSample()
  view.type('Find in notebook', 'print')
  assert.match(view.text(), /1\/1/)
  // The current hit carries the stronger accent.
  assert.equal(
    findAll(view.tree, (node) => String(node.props?.style?.borderLeft ?? '').includes('brand-primary')).length,
    1
  )

  const many = findCells(parsed.cells, 'e')
  assert.equal(many.length > 1, true)
  view.type('Find in notebook', 'e')
  assert.match(view.text(), new RegExp(`1/${many.length}`))
  assert.equal(
    findAll(view.tree, (node) => {
      const left = String(node.props?.style?.borderLeft ?? '')
      // The current hit uses the stronger accent, so both marks count as "marked".
      return left.includes('border-l2') || left.includes('brand-primary')
    }).length,
    many.length,
    'every hit is marked, the current one more strongly'
  )
  view.clickLabel('Next')
  assert.match(view.text(), new RegExp(`2/${many.length}`))
  view.clickLabel('Previous')
  assert.match(view.text(), new RegExp(`1/${many.length}`))
  // Stepping back from the first hit wraps to the last.
  view.clickLabel('Previous')
  assert.match(view.text(), new RegExp(`${many.length}/${many.length}`))

  view.type('Find in notebook', 'zzzz')
  assert.match(view.text(), /no matches/)
})

test('a table output offers its rows as TSV on the clipboard', async () => {
  const before = clipboardWrites.length
  const tree = renderSampleBody()
  // Every copy control is clicked, then the writes are inspected: the table's TSV is
  // the one that starts with the header row.
  const copies = findAll(
    tree,
    (node) =>
      (node.type === 'button' || node.type === 'Button') &&
      collectStrings(node).join(' ').includes('Copy') &&
      typeof node.props?.onClick === 'function'
  )
  assert.equal(copies.length > 0, true)
  for (const control of copies) control.props.onClick()
  await Promise.resolve()
  await Promise.resolve()
  const written = clipboardWrites.slice(before)
  const tsv = written.find((value) => value.startsWith('\ta\tb'))
  assert.notEqual(tsv, undefined, `no TSV among ${JSON.stringify(written)}`)
  assert.equal(tsv, '\ta\tb\n0\t1\t2\n1\t3\t4')
})

test('an nbformat 3 fixture renders like any other notebook', () => {
  const old = readFileSync(fileURLToPath(new URL('./fixtures/nbformat3.ipynb', import.meta.url)), 'utf8')
  const tree = renderInline(old)
  // Two markdown cells (the heading became one) and three code cells.
  assert.equal(findAll(tree, (node) => node.type === 'MarkdownText').length, 2)
  assert.equal(findAll(tree, (node) => node.type === 'CodeBlock').length, 3)
  const text = collectStrings(tree).join('\n')
  assert.match(text, /hello from v3/)
  assert.match(text, /42/, 'the pyout survived the conversion')
  assert.match(text, /ValueError: boom/)
  // The prompt gutter uses the v3 prompt number.
  assert.match(text, /In \[3\]/)
})

test('a query highlights the matching text inside an output', () => {
  const notebook = inlineNotebook([
    {
      cell_type: 'code',
      execution_count: 1,
      metadata: {},
      source: 'log()',
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'alpha beta\nbeta gamma\n' }]
    }
  ])
  const plain = renderInline(notebook)
  assert.equal(findAll(plain, (node) => node.props?.['data-match'] === 'true').length, 0)

  const view = interactiveInline(notebook)
  view.type('Find in notebook', 'beta')
  const marks = findAll(view.tree, (node) => node.props?.['data-match'] === 'true')
  assert.equal(marks.length, 2, 'both occurrences are marked')
  assert.deepEqual(marks.map((mark) => mark.props.children), ['beta', 'beta'])
  // The surrounding text is untouched and still present.
  const pre = findAll(view.tree, (node) => node.type === 'pre')[0]
  assert.equal(collectStrings(pre).join(''), 'alpha beta\nbeta gamma\n')
  // Clearing the query removes the marks again.
  view.type('Find in notebook', '')
  assert.equal(findAll(view.tree, (node) => node.props?.['data-match'] === 'true').length, 0)
})

test('Enter steps through matches and Escape clears the query', () => {
  const parsed = parseNotebook(sampleText).notebook
  const many = findCells(parsed.cells, 'e')
  assert.equal(many.length > 1, true)

  const view = interactiveSample()
  view.type('Find in notebook', 'e')
  assert.match(view.text(), new RegExp(`1/${many.length}`))
  // The keyboard path is the same step function the buttons use.
  view.press('Find in notebook', { key: 'Enter' })
  assert.match(view.text(), new RegExp(`2/${many.length}`))
  view.press('Find in notebook', { key: 'Enter', shiftKey: true })
  assert.match(view.text(), new RegExp(`1/${many.length}`))
  // Stepping back from the first hit wraps to the last.
  view.press('Find in notebook', { key: 'Enter', shiftKey: true })
  assert.match(view.text(), new RegExp(`${many.length}/${many.length}`))
  view.press('Find in notebook', { key: 'Escape' })
  assert.equal(view.text().includes('/' + many.length), false, 'the query is cleared')
})

test('a scaled image states its scale and can be shown at its actual size', () => {
  // A figure is a raster: at a fraction of its size its labels shrink with it, which
  // is why the scale is stated rather than left to a hover cursor.
  const view = interactiveSample()
  const image = () => findAll(view.tree, (node) => node.type === 'img')[0]
  assert.equal(image().props.style.cursor, 'default', 'nothing is promised before the load')
  assert.equal(image().props.onClick, undefined)
  assert.equal(view.text().includes('View actual size'), false)

  // The browser reports the natural size the image actually has.
  image().props.onLoad({ currentTarget: { naturalWidth: 1800, naturalHeight: 1000, clientWidth: 600 } })
  view.rerender()
  assert.equal(image().props.style.cursor, 'zoom-in')
  assert.match(view.text(), /View actual size/)
  assert.match(view.text(), /33%/, 'the scale is stated')

  view.clickLabel('View actual size')
  assert.equal(image().props.style.maxWidth, 'none')
  assert.equal(image().props.style.cursor, 'zoom-out')
  assert.match(view.text(), /Fit width/)

  view.clickLabel('Fit width')
  assert.equal(image().props.style.maxWidth, '100%')
  assert.equal(image().props.style.cursor, 'zoom-in')

  // An image that is not scaled offers nothing, because nothing would change.
  const small = interactiveInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'plot()',
        outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/png': 'QUJD' } }]
      }
    ])
  )
  const smallImage = findAll(small.tree, (node) => node.type === 'img')[0]
  smallImage.props.onLoad({ currentTarget: { naturalWidth: 400, naturalHeight: 200, clientWidth: 900 } })
  small.rerender()
  assert.equal(findAll(small.tree, (node) => node.type === 'img')[0].props.style.cursor, 'default')
  assert.equal(small.text().includes('View actual size'), false)
})

test('a cell shows the run time it recorded, and its prompt column sticks', () => {
  const notebook = inlineNotebook([
    {
      cell_type: 'code',
      execution_count: 1,
      metadata: {
        execution: { 'iopub.execute_input': '2026-01-06T09:15:00.000Z', 'shell.execute_reply': '2026-01-06T09:15:01.500Z' }
      },
      source: 'slow()',
      outputs: []
    },
    { cell_type: 'code', execution_count: 2, metadata: {}, source: 'fast()', outputs: [] }
  ])
  const tree = renderInline(notebook)
  const text = collectStrings(tree).join('\n')
  assert.match(text, /1\.5 s/)
  assert.equal((text.match(/1\.5 s/g) ?? []).length, 1, 'only the cell that recorded a time shows one')
  // The prompt column is sticky, so a long cell keeps its number in view. Only a
  // browser can prove the stickiness itself; this pins the rule that provides it.
  const gutters = findAll(
    tree,
    (node) => node.props?.style?.position === 'sticky' && node.props.style?.top === 0 && node.props.style?.alignSelf === 'start'
  )
  assert.equal(gutters.length, 2, 'one per cell')
  assert.match(text, /In \[1\]/)
})

/** Run `read` with a stubbed computed style, so a theme read can be asserted. */
function withComputedStyle(values, read) {
  const previous = globalThis.getComputedStyle
  globalThis.getComputedStyle = (element) => ({
    color: values.color ?? 'rgb(20, 20, 20)',
    backgroundColor: element?.backgroundColor ?? 'rgba(0, 0, 0, 0)',
    getPropertyValue: (name) => values[name] ?? ''
  })
  try {
    return read()
  } finally {
    if (previous === undefined) delete globalThis.getComputedStyle
    else globalThis.getComputedStyle = previous
  }
}

test('the frame reads the theme from its own element, and derives when it cannot', () => {
  // The effect that reads the theme only ever ran in a browser before, so this is the
  // first time the two branches of `frameTheme` are pinned.
  const srcDocWith = (values) =>
    withComputedStyle(values, () => findAll(renderSampleBody(), (node) => node.type === 'iframe')[0].props.srcDoc)

  const resolved = srcDocWith({
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-label-primary': '#101010',
    '--dsw-alias-border-l1': '#dddddd',
    '--dsw-alias-bg-layer-2': '#f2f2f2'
  })
  assert.equal(resolved.includes('background:#ffffff'), true)
  assert.equal(resolved.includes('border-bottom:1px solid #dddddd'), true)
  assert.equal(resolved.includes('#f2f2f2'), true, 'the zebra tint is the theme’s')

  // Without resolvable variables the colors are derived. Falling back to
  // `currentColor` here is what once produced a black table grid.
  const derived = srcDocWith({})
  assert.equal(derived.includes('color-mix(in srgb, currentColor 25%, transparent)'), true)
  assert.equal(derived.includes('solid currentColor'), false)
  assert.equal(derived.includes('undefined'), false, 'a missing value must not reach the sheet')
})

test('the HTML frame sizes itself to its content, and only offers more when clamped', () => {
  const view = interactiveSample()
  const frame = () => findAll(view.tree, (node) => node.type === 'iframe')[0]
  // The first paint is a small fixed height; the load event replaces it.
  assert.equal(frame().props.style.height, 120)

  // Viewport 800 → the cap is 560, so tall content is clamped and the control appears.
  frame().props.onLoad({
    currentTarget: { contentDocument: { documentElement: { scrollHeight: 5000 }, body: { scrollHeight: 5000 } } }
  })
  view.rerender()
  assert.equal(frame().props.style.height, 560)
  assert.match(view.text(), /Show more/)

  // Short content: the frame is exactly tall enough, and no control is offered.
  frame().props.onLoad({
    currentTarget: { contentDocument: { documentElement: { scrollHeight: 120 }, body: { scrollHeight: 120 } } }
  })
  view.rerender()
  assert.equal(frame().props.style.height, 122)
  assert.equal(view.text().includes('Show more'), false, 'no control without clamping')
})

test('a capped output renders only what the cap shows', () => {
  // Capping the height alone still builds every line, so a 5000-line log put 5000 lines
  // in the DOM. The rest arrives when the reader asks for it.
  const lines = Array.from({ length: 5000 }, (_, at) => `line ${at}`).join('\n')
  const view = interactiveInline(
    inlineNotebook([
      { cell_type: 'code', execution_count: 1, metadata: {}, source: 'log()', outputs: [{ output_type: 'stream', name: 'stdout', text: lines }] }
    ])
  )
  const renderedLength = () => collectStrings(findAll(view.tree, (node) => node.type === 'pre')[0]).join('').length
  assert.equal(renderedLength() < 400, true, `the capped output holds little (${renderedLength()})`)
  assert.match(view.text(), /Show all 5000 lines/, 'the label still counts every line')
  view.clickLabel('Show all')
  assert.equal(renderedLength() > 40000, true, 'expanding renders the rest')
  assert.equal(collectStrings(view.tree).join('').includes('line 4999'), true)
})

test('images are lazy, so a notebook of figures does not decode them all', () => {
  const image = findAll(renderSampleBody(), (node) => node.type === 'img')[0]
  assert.equal(image.props.loading, 'lazy')
  assert.equal(image.props.decoding, 'async')
  // The frame already had it; this pins both.
  assert.equal(findAll(renderSampleBody(), (node) => node.type === 'iframe')[0].props.loading, 'lazy')
})

test('no copy control is offered when nothing can write to the clipboard', () => {
  // A control that silently does nothing reads as a broken plugin, so the copy
  // controls are absent instead of dead. Node's `navigator` has no clipboard, which is
  // the same situation as a host that provides no helper.
  assert.equal(globalThis.navigator?.clipboard, undefined, 'this test needs a host without a clipboard')
  const { registered } = mount({ primitiveOverrides: { writeClipboard: undefined } })
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })
  assert.equal(collectStrings(tree).join('\n').includes('Copy'), false)
  // Everything else is still offered.
  assert.match(collectStrings(tree).join('\n'), /View raw JSON/)
})

test('a reader can collapse either half of a cell', () => {
  const view = interactiveInline(
    inlineNotebook([
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: 'work()',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'out\n' }]
      }
    ])
  )
  assert.equal(findAll(view.tree, (node) => node.type === 'CodeBlock').length, 1)
  view.clickLabel('Hide input')
  assert.equal(findAll(view.tree, (node) => node.type === 'CodeBlock').length, 0, 'the input is hidden')
  view.clickLabel('Show input')
  assert.equal(findAll(view.tree, (node) => node.type === 'CodeBlock').length, 1)

  assert.equal(findAll(view.tree, (node) => node.type === 'pre').length, 1)
  view.clickLabel('Hide output')
  assert.equal(findAll(view.tree, (node) => node.type === 'pre').length, 0, 'the output is hidden')
  view.clickLabel('Show output')
  assert.equal(findAll(view.tree, (node) => node.type === 'pre').length, 1)
})

test('a relative figure that cannot be addressed says why', () => {
  const notebook = inlineNotebook([
    { cell_type: 'markdown', metadata: {}, source: 'A figure:\n\n![fig](figs/a.png)\n' },
    { cell_type: 'markdown', metadata: {}, source: 'A remote one:\n\n![r](https://example.com/x.png)\n' }
  ])
  // No Host absolute path: the file resolver has nothing to join to.
  const without = collectStrings(renderInline(notebook)).join('\n')
  assert.match(without, /figs\/a\.png/)
  assert.match(without, /cannot be shown/)
  // The only remote image does not produce the note at all.
  const onlyRemote = collectStrings(
    renderInline(inlineNotebook([{ cell_type: 'markdown', metadata: {}, source: '![r](https://example.com/x.png)' }]))
  ).join('\n')
  assert.equal(onlyRemote.includes('cannot be shown'), false)
  // With a path there is nothing to explain.
  const withPath = collectStrings(
    renderInline(notebook, {
      resourceAddress: 'dsh-resource://file/session/s1/nb/demo.ipynb',
      useResource: () => ({ status: 'ready', value: { absolutePath: '/work/nb/demo.ipynb' } })
    })
  ).join('\n')
  assert.equal(withPath.includes('cannot be shown'), false)
})

test('the self-check states what the deployment provides', () => {
  const view = interactiveSample()
  assert.equal(view.text().includes('What this deployment actually provides'), false, 'closed until asked')

  view.clickLabel('Self-check')
  // Joined with a space: a row's label and value are sibling nodes, so a newline join
  // would split them.
  const opened = collectStrings(view.tree).join(' ')
  assert.match(opened, /What this deployment actually provides/)
  // The build id, so a stale tab is identifiable rather than guessed at.
  assert.match(opened, /build [0-9a-f]{8}/)
  // Atoms, the clipboard and the theme read are all reported.
  assert.match(opened, /MarkdownText ✓/)
  assert.match(opened, /clipboard (available|unavailable)/)
  assert.match(opened, /cells \d+\/\d+/)
  // The harness's window is browser-shaped, so the viewport is known here.
  assert.match(opened, /viewport 1200×800/)

  view.clickLabel('Self-check')
  assert.equal(collectStrings(view.tree).join(' ').includes('What this deployment actually provides'), false, 'and closes again')
})

test('the self-check reports theme variables as unresolvable when they are', () => {
  // The other branch of the same row: nothing resolves, so the colors are derived.
  const panel = withComputedStyle({}, () => {
    const view = interactiveSample()
    view.clickLabel('Self-check')
    return collectStrings(view.tree).join(' ')
  })
  assert.match(panel, /theme tokens do not resolve/)
  // With the variables resolving, the same row says so.
  const resolved = withComputedStyle(
    { '--dsw-alias-label-primary': '#101010' },
    () => {
      const view = interactiveSample()
      view.clickLabel('Self-check')
      return collectStrings(view.tree).join(' ')
    }
  )
  assert.match(resolved, /theme tokens resolve/)
})

test('a render error is caught by the boundary instead of retiring the entry', () => {
  const { registered } = mount({
    primitiveOverrides: {
      MarkdownText() {
        throw new Error('MarkdownText exploded')
      }
    }
  })
  const Body = registered.get('sidebar.right.tab.document|jupyter-notebook').component
  const tree = rendered(Body, {
    content: { kind: 'bytes', data: new TextEncoder().encode(sampleText) },
    wrap: false,
    scrollportRef: () => {}
  })
  const text = findAll(tree, (node) => typeof node.props?.children === 'string')
    .map((node) => node.props.children)
    .join('\n')
  assert.match(text, /dsh-jupyter render failed/)
  assert.match(text, /MarkdownText exploded/)
})

test('a locale failure falls back to the bundled copy instead of throwing', () => {
  const loaded = loadBundle()
  const registered = new Map()
  const ctx = {
    get: (name) => {
      if (name === 'slots') return { inject: (_n, cb) => cb(), register: (o, c) => { registered.set(o.name, c); return () => {} } }
      if (name === 'locale') {
        return {
          register: () => () => {},
          bind: () => () => {
            throw new Error('message missing')
          }
        }
      }
      return undefined
    },
    effect: (fn) => fn(),
    inject: (deps, callback) => {
      callback(ctx)
      return Promise.resolve()
    }
  }
  loaded.exports.apply(ctx)
  const tree = renderTree(registered.get('tool.call.toolview')({
    phase: 'result',
    block: {
      isError: false,
      meta: { v: 1, language: 'python', kernel: 'python3', cellCount: 1, truncated: false, cells: [{ i: 1, kind: 'markdown', source: '# Title' }] },
      content: [],
      call: { argsRaw: '{"file_path":"a.ipynb"}' }
    },
    openFile: () => {}
  }))
  const markdown = findAll(tree, (node) => node.type === 'MarkdownText')
  assert.equal(markdown.length, 1)
  assert.equal(markdown[0].props.labels.code.copyLabel, 'Copy')
})

test('a locale service that answers a missing message with the key still yields bundled copy', () => {
  // Regression: dropping the `value !== key` guard made an echoing locale service
  // print raw keys like `output.expandLines` at the user.
  const loaded = loadBundle()
  const registered = new Map()
  const ctx = {
    get: (name) => {
      if (name === 'slots') {
        return {
          inject: (_n, callback) => callback(),
          register: (options, component) => {
            registered.set(options.name, component)
            return () => {}
          }
        }
      }
      if (name === 'locale') return { register: () => () => {}, bind: () => (key) => key }
      return undefined
    },
    effect: (fn) => fn(),
    inject: (deps, callback) => {
      callback(ctx)
      return Promise.resolve()
    }
  }
  loaded.exports.apply(ctx)
  const tree = renderTree(
    registered.get('tool.call.toolview')({
      phase: 'result',
      block: {
        isError: false,
        meta: { v: 1, language: 'python', kernel: 'python3', cellCount: 1, truncated: false, cells: [{ i: 1, kind: 'code', exec: 1, source: 'x', outputs: [] }] },
        content: [],
        call: { argsRaw: '{"file_path":"a.ipynb"}' }
      },
      openFile: () => {}
    })
  )
  const code = findAll(tree, (node) => node.type === 'CodeBlock')
  assert.equal(code.length, 1)
  assert.equal(code[0].props.toolbarLabels.codeLabel, 'Code')
  assert.equal(code[0].props.copyLabel, 'Copy')
})

test('the tool card summary is localized, not hard-coded English', () => {
  const { registered } = mount()
  const Card = registered.get('tool.call.toolview|read_notebook').component
  const tree = rendered(Card, {
    phase: 'result',
    block: {
      isError: false,
      meta: { v: 1, language: 'python', kernel: 'python3', cellCount: 2, truncated: false, cells: [
        { i: 1, kind: 'markdown', source: '# t' },
        { i: 2, kind: 'code', exec: 1, source: 'x', outputs: [] }
      ] },
      content: [],
      call: { argsRaw: '{"file_path":"a.ipynb"}' }
    },
    openFile: () => {}
  })
  const text = collectStrings(tree).join('\n')
  // The test dictionary carries the Chinese strings, so seeing them proves the
  // card asks the locale rather than printing its own copy.
  assert.match(text, /2 个单元格/)
  assert.match(text, /1 段代码/)
  assert.equal(text.includes('2 cells'), false)
})

test('the tool card reads the path from the call arguments and opens it', () => {
  const { registered } = mount()
  const Card = registered.get('tool.call.toolview|read_notebook').component
  const opened = []
  const tree = rendered(Card, {
    phase: 'result',
    block: {
      isError: false,
      meta: { v: 1, language: 'python', kernel: 'python3', cellCount: 0, truncated: false, cells: [] },
      content: [],
      call: { name: 'read_notebook', argsRaw: JSON.stringify({ file_path: 'notebooks/demo.ipynb' }) }
    },
    openFile: (path) => opened.push(path)
  })
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 1)
  buttons[0].props.onClick()
  assert.deepEqual(opened, ['notebooks/demo.ipynb'])
})

test('the tool card falls back to the result text when no metadata was threaded', () => {
  const { registered } = mount()
  const Card = registered.get('tool.call.toolview|read_notebook').component
  const digest = { v: 1, language: 'python', kernel: 'python3', cellCount: 1, truncated: false, cells: [
    { i: 1, kind: 'code', exec: 2, source: 'x = 1', outputs: [] }
  ] }
  const tree = rendered(Card, {
    phase: 'result',
    block: { isError: false, content: [{ type: 'text', text: JSON.stringify(digest) }], call: { argsRaw: '{"file_path":"a.ipynb"}' } },
    openFile: () => {}
  })
  assert.equal(findAll(tree, (node) => node.type === 'CodeBlock').length, 1)
})

test('the tool card shows the failure text of a settled error', () => {
  const { registered } = mount()
  const Card = registered.get('tool.call.toolview|read_notebook').component
  const tree = rendered(Card, {
    phase: 'result',
    block: { isError: true, content: [{ type: 'text', text: 'Error: demo.ipynb is not a readable notebook: not valid JSON' }] },
    openFile: () => {}
  })
  const pre = findAll(tree, (node) => node.type === 'pre')
  assert.equal(pre.length, 1)
  assert.match(pre[0].props.children, /not a readable notebook/)
})
