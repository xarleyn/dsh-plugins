# SPEC: `dsh-plugin-log-ui`

> **Статус (2026-09-05):** реализовано в объёме MVP (v0.2.0) — settings card,
> обнаружение консьюмеров, уровни по умолчанию и per-plugin override, формат
> `text | json`, живое применение политики.

## 1. Summary

`dsh-plugin-log-ui` — клиентский плагин-настройщик для
[`@yadsh/dsh-plugin-log`](../../packages/plugin-log). Добавляет карточку
**Plugin logging** в *Settings → Plugins → Plugin Configuration* и через
Typert-сервис применяет политику логирования к уже зарегистрированным и новым
консьюмерам `@yadsh/dsh-plugin-log`.

## 2. Обязательства

- Runtime id: `dsh-plugin-log-ui`; npm package: `@yadsh/dsh-plugin-log-ui`.
- Settings namespace: `plugin-log` (схема `ConfigSchema` в `src/config.ts`).
- Cordis-сервис: `ctx.pluginLogUi` (`TypertRemoteService`, namespace
  `pluginLogUi`).

## 3. Поведение

1. Карточка читает снимок реестра логгеров
   (`getRegisteredPluginLoggers` + подписка на `subscribePluginLoggerRegistry`)
   и показывает: дефолтный уровень, per-plugin override'ы, формат файла
   (`text | json`).
2. Изменения применяются через `setPluginLogLevel` / `setPluginLogFormat`;
   приложение действует и на уже запущенные логгеры, и на новые регистрации.
3. Состояние хранится в settings-провайдере DSH под namespace `plugin-log`;
   источник истины для схемы — `ConfigSchema`, резолв — `resolveConfig`.
4. Файловое логирование и форматы описаны в
   [docs/PLUGIN_LOGGING.md](../../docs/PLUGIN_LOGGING.md); этот плагин не
   пишет логи сам, кроме собственного диагностического логгера
   (`dsh-plugin-log-ui`).

## 4. Не входит в объём (MVP)

- Просмотр содержимого лог-файлов и стриминг записей в UI.
- Ротация/ретеншн — ответственность `@yadsh/dsh-plugin-log`.
- Per-module (внутриплагинные) уровни.
