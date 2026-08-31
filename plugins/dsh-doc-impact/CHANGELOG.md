## 0.2.3 (2026-08-31)

### 🩹 Fixes

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

- Build the browser client from TypeScript with tsdown while preserving the ([3e0ac46](https://github.com/xarleyn/dsh-plugins/commit/3e0ac46))
  classic ModuleLoader bundle and plugin settings-card contract.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn