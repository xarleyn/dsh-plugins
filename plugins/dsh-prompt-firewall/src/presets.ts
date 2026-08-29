import type { FirewallPreset, PromptFirewallConfig } from './types.js'

export const CLEAN_BLOCKED_SECTIONS = Object.freeze([
  'plugin:dsh-liangshen',
  'plugin:dsh-ssh',
  'plugin:task-board',
  'plugin:dsh-desktop-launcher',
] as const)

export const PRESETS: Readonly<Record<FirewallPreset, Readonly<PromptFirewallConfig>>> = Object.freeze({
  clean: Object.freeze({
    mode: 'blocklist',
    blockedSections: [...CLEAN_BLOCKED_SECTIONS],
  }),
  strict: Object.freeze({
    mode: 'allowlist',
    unknownPluginPolicy: 'block',
  }),
  'audit-only': Object.freeze({
    mode: 'audit',
  }),
})

export function getPreset(name: FirewallPreset | undefined): Readonly<PromptFirewallConfig> {
  return name === undefined ? {} : PRESETS[name]
}

