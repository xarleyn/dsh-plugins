---
"@yadsh/dsh-qa-integrations": patch
---

The client Integrations page now says how to connect with your own token. A
deployment that manages a service credential switches that mode on by default,
and until now the personal token field appeared only after the user guessed to
uncheck «Использовать сервисный токен»; the connect form offers «Ввести свой
токен» beside the checkbox instead, on every provider that has a managed
credential.

The «оператор ничего не настроил» note is gone from the Jira, Confluence, Test
IT and Weblate cards whose sites the operator did configure. It used to render
whatever the deployment listed, so a connected card could claim there was
nothing to connect to.
