---
"@yadsh/dsh-doc-impact": patch
---

Internal cleanup: the client-bundle gate now asserts the ModuleLoader registration (window.__ModuleLoader__.load) explicitly next to the factory id. No runtime changes.
