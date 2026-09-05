/**
 * A stub of the DSH web `window.__ModuleLoader__` hook. Client bundle tests
 * evaluate the built factory script against `stub.window` (or a matching
 * sandbox) and inspect {@link ModuleLoaderStub.registrations} for the
 * `{ id, factory }` metadata the bundle registered.
 */
export interface ModuleLoaderRegistration {
  id: string;
  factory: (requireFn: (name: string) => unknown) => unknown;
}

export interface ModuleLoaderStub {
  window: {
    __ModuleLoader__: {
      load(registration: ModuleLoaderRegistration): void;
    };
  };
  registrations: ModuleLoaderRegistration[];
}

export function createModuleLoaderStub(): ModuleLoaderStub {
  const registrations: ModuleLoaderRegistration[] = [];
  return {
    window: {
      __ModuleLoader__: {
        load(registration: ModuleLoaderRegistration): void {
          registrations.push(registration);
        },
      },
    },
    registrations,
  };
}
