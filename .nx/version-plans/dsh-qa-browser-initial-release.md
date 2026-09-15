---
"@yadsh/dsh-qa-browser": minor
---

Introduce a session-scoped Playwright Browser runtime for DeepSeek Harness and
its QA Surface panel extension. The initial release provides isolated persistent
BrowserContexts, semantic ref-based tools, durable screenshots, server-enforced
network policy, automatic panel reveal, and explicit leased human takeover of
the same agent tab.

Chromium starts lazily and is never downloaded from `postinstall`. Container
deployments can point at a managed browser executable while retaining the
Chromium sandbox by default.
