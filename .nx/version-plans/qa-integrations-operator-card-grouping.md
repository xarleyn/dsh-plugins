---
"@yadsh/dsh-qa-integrations": patch
---

The operator card reads as grouped blocks instead of one flat run of fields.

Every provider section used to be a single grid of fourteen to twenty-three
controls in source order: the provider switch, the instance editor, the
capability toggles and the numeric limits all carried the same weight, so a two
column layout could put an instance row next to "Профиль: чтение" and the
knobs a reader rarely touches sat between the ones they came for. Each section
now has four labelled blocks — «Провайдер», «Подключение» (connection editors
own the full width), «Что доступно агенту» as a checklist whose box leads the
label, and «Ограничения и повторы» folded away until someone asks for it.
Capability keys and their defaults are unchanged, only the headings that say
what belongs with what are new.

A collapsed section also says what it holds: `включён · 1 инстанс · доступно
7 из 7`, computed from the same values the toggles show, so a reader can see
which provider is off or half-open without expanding seven sections. Field
captions are now real `<label>`s tied to their inputs, which makes a caption
click land in the field and lets assistive technology name it.
