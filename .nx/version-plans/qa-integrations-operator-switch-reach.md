---
"@yadsh/dsh-qa-integrations": patch
---

The operator's «Провайдер включён» switch now reaches the model. A provider this
deployment switched off keeps neither its tools mounted nor its names admitted
as principal-scoped, so a disabled integration takes its tool surface away
instead of leaving `testit_*`-style names that every call can only refuse with
«Integration provider is unavailable».

The client `Интеграции` page re-reads what the service offers when the provider
cards mount, and a card whose provider is gone stops rendering — an open
settings dialog no longer keeps offering «Подключить сервисный токен» for an
integration the operator has just switched off. A read that has not answered or
has failed keeps every card, so no form disappears on a transport problem.
