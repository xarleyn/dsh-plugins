import { generateTypert } from '@yadsh/dsh-plugin-scripts/generate-typert'

await generateTypert({
  packageRoot: new URL('../', import.meta.url),
  packageName: '@yadsh/dsh-prompt-firewall',
  runtimeId: 'dsh-prompt-firewall',
  serviceName: 'promptFirewall',
})
