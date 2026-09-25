/**
 * Check that everything the shipped entries reference at runtime is inside the
 * package's `files` list.
 *
 * `npm pack` is not available in the bundled runtime, so the tarball cannot be
 * inspected directly here; this is the part of that question that can be answered by
 * reading the manifest and the two entries a recipient loads.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (name) => readFileSync(new URL(name, root), 'utf8')
const manifest = JSON.parse(read('package.json'))

const shipped = new Set(manifest.files)
const problems = []

/** Resolve a relative specifier against the package, not the filesystem. */
function resolveFrom(from, specifier) {
  const parts = from.split('/').slice(0, -1)
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

/** A relative specifier from one shipped file must land inside the `files` set. */
function checkReferences(from, text) {
  for (const match of text.matchAll(/(?:from|require\()\s*['"](\.[^'"]+)['"]/g)) {
    const specifier = match[1]
    const resolved = resolveFrom(from, specifier)
    const top = resolved.split('/')[0]
    if (!shipped.has(top)) problems.push(`${from} references ${specifier} -> ${resolved}, but "${top}" is not in files[]`)
    else console.log(`  ok  ${from} -> ${specifier} (${resolved})`)
  }
}

console.log(`files[] = ${manifest.files.join(', ')}`)
checkReferences('lib/index.js', read('lib/index.js'))
checkReferences('lib/client.js', read('lib/client.js'))

// The browser half must keep requiring only what the web shell seeds.
const requested = [...read('lib/client.js').matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
console.log(`lib/client.js requires: ${requested.join(', ')}`)

// npm always includes these three, whatever `files` says.
for (const always of ['package.json', 'README.md', 'LICENSE']) {
  console.log(`  always packed: ${always} (${read(always).length} bytes)`)
}

if (problems.length > 0) {
  console.error(`\nreference problems:\n${problems.map((line) => `  - ${line}`).join('\n')}`)
  process.exit(1)
}
console.log('\nevery runtime reference resolves inside the packed set')
