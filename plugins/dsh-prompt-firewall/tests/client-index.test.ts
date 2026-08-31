import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'

describe('client activation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses a context injected with the mounted Remote namespace', async () => {
    const inspect = vi.fn(async () => ({ ok: true, value: {} }))
    const setSectionPolicy = vi.fn(async () => ({ ok: true, value: undefined }))
    const promptFirewall = { inspect, setSectionPolicy }
    const scope = {}
    let cardFace: (() => unknown) | undefined

    const disposeSlot = vi.fn()
    const readyCtx = {
      remote: { promptFirewall },
      settingsScope: { bind: vi.fn(() => scope) },
      slots: {
        inject: vi.fn((_name: string, callback: () => unknown) => callback()),
        register: vi.fn((options: { inject: () => unknown }) => {
          cardFace = options.inject
          return disposeSlot
        }),
      },
    }
    const inject = vi.fn(async (
      dependencies: string[],
      callback: (ctx: typeof readyCtx) => unknown,
    ) => {
      expect(dependencies).toEqual(['remote.promptFirewall'])
      callback(readyCtx)
    })
    const disposeRemote = vi.fn(async () => undefined)
    const mount = vi.fn(async () => disposeRemote)
    const remote = { $mount: mount } as Record<string, unknown>
    Object.defineProperty(remote, 'promptFirewall', {
      get() {
        throw new Error('cannot get property "remote.promptFirewall" without inject')
      },
    })

    const style = {
      dataset: {} as Record<string, string>,
      textContent: '',
      remove: vi.fn(),
    }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => style),
      head: { appendChild: vi.fn() },
    })

    const dispose = await apply({ remote, inject } as never)
    const face = cardFace?.() as {
      inspect(): Promise<unknown>
      setSectionPolicy(name: string, policy: string, revision?: number): Promise<unknown>
    }

    await expect(face.inspect()).resolves.toEqual({ ok: true, value: {} })
    await expect(face.setSectionPolicy('plugin:test', 'block', 2))
      .resolves.toEqual({ ok: true, value: undefined })
    expect(inspect).toHaveBeenCalledOnce()
    expect(setSectionPolicy).toHaveBeenCalledWith('plugin:test', 'block', 2)
    expect(mount).toHaveBeenCalledOnce()
    expect(inject).toHaveBeenCalledOnce()

    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })
})
