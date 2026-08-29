import type { UserConfig } from 'tsdown'

const client: UserConfig = {
  name: 'dsh-prompt-firewall/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => specifier === 'react' || specifier === 'react/jsx-runtime',
    alwaysBundle: specifier => specifier !== 'react' && specifier !== 'react/jsx-runtime',
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: 'window.__ModuleLoader__.load({ id: "dsh-prompt-firewall", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [client]
