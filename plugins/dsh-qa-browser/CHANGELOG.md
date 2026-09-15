## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce a session-scoped Playwright Browser runtime for DeepSeek Harness and ([3312277](https://github.com/xarleyn/dsh-plugins/commit/3312277))
  its QA Surface panel extension. The initial release provides isolated persistent
  BrowserContexts, semantic ref-based tools, durable screenshots, server-enforced
  network policy, automatic panel reveal, and explicit leased human takeover of
  the same agent tab.

  Chromium starts lazily and is never downloaded from `postinstall`. Container
  deployments can point at a managed browser executable while retaining the
  Chromium sandbox by default.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn