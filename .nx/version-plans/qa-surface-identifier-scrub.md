---
"@yadsh/dsh-qa-surface": patch
---

Two test fixtures and one administration specification carried a real
deployment: a corporate Jira host with a live page id, the page's own title, and
a merge-request review naming real authors, a real repository path and an
internal task key. They now use the synthetic host, page and review, with the
same structure the renderer and the source collector are being tested for and no
change in behaviour.
