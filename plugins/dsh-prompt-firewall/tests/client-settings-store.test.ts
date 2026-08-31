import { describe, expect, it, vi } from 'vitest'
import { bindSettingsExternalStore } from '../src/client/settings-store.js'

describe('settings external store binding', () => {
  it('preserves the SettingsScope receiver for React callbacks', () => {
    const listener = vi.fn()
    const unsubscribe = vi.fn()
    const scope = {
      value: { status: 'ready' },
      subscribe(callback: () => void) {
        expect(this).toBe(scope)
        expect(callback).toBe(listener)
        return unsubscribe
      },
      getSnapshot() {
        expect(this).toBe(scope)
        return this.value
      },
    }
    const store = bindSettingsExternalStore(scope)

    expect(store.getSnapshot()).toBe(scope.value)
    expect(store.subscribe(listener)).toBe(unsubscribe)
  })
})
