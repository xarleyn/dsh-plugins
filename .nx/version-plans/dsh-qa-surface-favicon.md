---
"@yadsh/dsh-qa-surface": patch
---

Brand the tab favicon while the surface owns the route. The guard swaps the
favicon to `branding.logoUrl` for as long as the QA route is active — the same
logo the sidebar and the auth gate render — and restores the host's own icon
links on exit. On proxy-fronted deployments `DSH_QA_FAVICON_URL` pins the icon
from the first paint, before any bundle loads.
