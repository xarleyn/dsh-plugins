import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

assert.equal(manifest.name, '@yadsh/dsh-prompt-firewall')
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(manifest.dsh?.client?.platform, 'web')

for (const path of [
  'lib/index.js',
  'lib/client.js',
  'lib/typert.host.js',
  'lib/typert.host.d.ts',
  'lib/typert.remote-client.js',
  'lib/typert.remote-client.d.ts',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'cordis.patch.yml',
]) {
  assert((await stat(new URL(path, root))).isFile(), `${path} must be built`)
}

const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
assert.match(patch, /id:\s*prompt-firewall/u)
assert.match(patch, /name:\s*dsh-prompt-firewall/u)

const client = await readFile(new URL('lib/client.js', root), 'utf8')
assert.match(client, /id:\s*"dsh-prompt-firewall"/u)

console.log('built package contract passed')
