---
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-domain-experts": patch
---

Cancel domain reviewers on a parent stop or round deadline even with all numeric limits disabled. Concurrent teardown waits for the same child disposal. A domain-experts service without cancellable review support now follows the configured failure policy before starting a reviewer.
