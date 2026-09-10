import { generateTypert } from '@yadsh/dsh-plugin-scripts/generate-typert'

await generateTypert({
  packageRoot: new URL('../', import.meta.url),
  packageName: '@yadsh/dsh-web-fetch-authenticated',
  runtimeId: 'dsh-web-fetch-authenticated',
  serviceName: 'webFetchAuth',
})
