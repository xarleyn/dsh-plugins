# SPEC: `dsh-plugin-log-ui`

> **Статус (2026-09-13):** реализовано — settings card, обнаружение
> консьюмеров, уровни по умолчанию и per-plugin override, формат `text | json`,
> живое применение политики; панель живого потока **Plugin logs** в правом
> сайдбаре (фильтры по уровням и тексту, раскраска по уровням, пауза/следование,
> явный счётчик вытесненных записей).

## 1. Summary

`dsh-plugin-log-ui` — клиентский плагин-настройщик для
[`@yadsh/dsh-plugin-log`](../../packages/plugin-log). Добавляет карточку
**Plugin logging** в *Settings → Plugins → Plugin Configuration* и через
Typert-сервис применяет политику логирования к уже зарегистрированным и новым
консьюмерам `@yadsh/dsh-plugin-log`, а также панель **Plugin logs** —
page-тип таба правого сайдбара DSH, показывающий записи вживую.

## 2. Обязательства

- Runtime id: `dsh-plugin-log-ui`; npm package: `@yadsh/dsh-plugin-log-ui`.
- Settings namespace: `plugin-log` (схема `ConfigSchema` в `src/config.ts`).
- Cordis-сервис: `ctx.pluginLogUi` (`TypertRemoteService`, namespace
  `pluginLogUi`).
- Тип таба: `kind: plugin-log`, `id: @yadsh/dsh-plugin-log-ui/panel`,
  body — в keyed-слоте `sidebar.right.pane.tab` под тем же `id`.

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
5. Хост подписывается на шину записей `subscribePluginLogRecords` и держит
   кольцевой буфер (`PluginLogBuffer`, 2000 записей). Панель опрашивает
   `pluginLogUi.tail(cursor, limit)`: возвращаются записи от курсора, следующий
   курсор и число записей, вытесненных до прочтения. Поля записи рендерятся в
   строки на хосте (глубина, длина и число полей ограничены), потому что
   Remote несёт только плоский JSON.
6. Панель фильтрует окно в браузере (уровни + подстрока по всей строке),
   раскрашивает уровень и опрашивает хост только когда таб видим
   (`tab.visible`) и не поставлен на паузу.

## 4. Не входит в объём

- Просмотр и чтение лог-файлов (панель показывает поток записей, а не файл).
- Ротация/ретеншн — ответственность `@yadsh/dsh-plugin-log`.
- Per-module (внутриплагинные) уровни.
- Поиск по истории за пределами кольцевого буфера хоста.
