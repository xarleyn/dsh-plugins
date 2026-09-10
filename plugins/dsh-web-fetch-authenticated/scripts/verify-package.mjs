import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { verifyPluginCardContract } from '../../../scripts/verify-plugin-card-contract.mjs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

assert.equal(manifest.name, '@yadsh/dsh-web-fetch-authenticated')
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
assert.match(patch, /id:\s*web-fetch-authenticated/u)
assert.match(patch, /name:\s*"@yadsh\/dsh-web-fetch-authenticated"/u)

const client = await readFile(new URL('lib/client.js', root), 'utf8')
// Browser bundle identity: the ModuleLoader registration id is the FULL package name.
assert.match(client, /window\.__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-web-fetch-authenticated"/u)
// The credentials control must stay write-only: no component state may hold a
// fetched credential value, and the secret input never echoes stored values.
assert.doesNotMatch(client, /credentials\.value/u)
assert.match(client, /type: "password"/u)
// The tester/diagnostics render only sanitized report fields.
assert.match(client, /authApplied/u)
assert.doesNotMatch(client, /credentialValue/u)

verifyPluginCardContract(client, {
  legacyPatterns: [/\.wfa-card\{/u, /\.dsh-plugin-card \*/u],
})

// Host entry registers the provider under the seam-facing id `authenticated`.
const entry = await readFile(new URL('lib/index.js', root), 'utf8')
assert.match(entry, /registerFetchProvider/u)
const providerModule = await readFile(new URL('lib/provider.js', root), 'utf8')
assert.match(providerModule, /AUTHENTICATED_FETCH_PROVIDER_ID = 'authenticated'/u)

console.log('built package contract passed')
