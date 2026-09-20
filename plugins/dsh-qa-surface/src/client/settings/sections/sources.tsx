/**
 * Sources: which sources the assistant may cite and how they are shown. Most
 * of the controls live behind "advanced" disclosures so the default view
 * carries only the collection switches a deployment actually argues about.
 */

import { Notice, NumberField, Section, Toggle } from "../fields.js";
import { formatCount } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/** Which sources the assistant may cite, and how they are shown. */
export function SourcesSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const sources = config?.sources;
  const enabled = sources?.enabled ?? true;
  const filePreview = sources?.filePreview;
  const maxBytes = filePreview?.maxBytes ?? 2_000_000;
  const maxRender = filePreview?.maxMarkdownRenderBytes ?? 1_000_000;
  const maxListing = filePreview?.maxListingEntries ?? 500;
  const paths: SectionPaths = [["sources"]];
  const modified = overriddenAny(props, paths);
  const blocked = disabled || !enabled;
  return (
    <Section
      title="Источники"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <Toggle
          checked={enabled}
          disabled={disabled}
          label="Собирать источники"
          hint="Ссылки, файлы и результаты поиска, на которые опирался ответ, показываются под сообщением."
          onChange={(value) => {
            props.write(["sources", "enabled"], value);
          }}
        />
        <Toggle
          checked={sources?.collect?.parentAgent ?? true}
          disabled={blocked}
          label="Источники основного агента"
          hint="Собираются с хода самого помощника."
          onChange={(value) => {
            props.write(["sources", "collect", "parentAgent"], value);
          }}
        />
        <Toggle
          checked={sources?.collect?.subagents ?? true}
          disabled={blocked}
          label="Источники субагентов"
          hint="Собираются и с делегированных экспертов."
          onChange={(value) => {
            props.write(["sources", "collect", "subagents"], value);
          }}
        />
        <Toggle
          checked={sources?.collect?.persistTurnEvent ?? true}
          disabled={blocked}
          label="Писать источники в журнал"
          hint="Позволяет восстановить список источников при перезагрузке страницы."
          onChange={(value) => {
            props.write(["sources", "collect", "persistTurnEvent"], value);
          }}
        />
      </div>
      <details className="qa-card-advanced">
        <summary>Отображение</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={sources?.display?.sidebar ?? true}
            disabled={blocked}
            label="Панель источников"
            hint="Боковая панель со списком источников хода."
            onChange={(value) => {
              props.write(["sources", "display", "sidebar"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.footer ?? true}
            disabled={blocked}
            label="Строка источников под ответом"
            hint="Короткая сводка под сообщением."
            onChange={(value) => {
              props.write(["sources", "display", "footer"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.groupByKind ?? true}
            disabled={blocked}
            label="Группировать по типу"
            hint="Файлы, ссылки и поиск идут отдельными группами."
            onChange={(value) => {
              props.write(["sources", "display", "groupByKind"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.showDiscovered ?? false}
            disabled={blocked}
            label="Показывать найденное попутно"
            hint="Источники, которые агент не подтвердил как использованные."
            onChange={(value) => {
              props.write(["sources", "display", "showDiscovered"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.showOriginBadges ?? false}
            disabled={blocked}
            label="Пометки происхождения"
            hint="Откуда взялся источник: файл, поиск, инструмент."
            onChange={(value) => {
              props.write(["sources", "display", "showOriginBadges"], value);
            }}
          />
          <NumberField
            label="Видимых источников на группу"
            value={sources?.display?.maxInitiallyVisiblePerGroup ?? 8}
            min={1}
            max={100}
            disabled={blocked}
            hint="Остальные скрыты под «показать все»."
            onChange={(value) => {
              props.write(
                ["sources", "display", "maxInitiallyVisiblePerGroup"],
                value,
              );
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Поиск в сети</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={
              sources?.webSearch?.promoteSearchResultsWithoutFetch ?? true
            }
            disabled={blocked}
            label="Ссылки из поиска — тоже источники"
            hint="Результат поиска засчитывается как источник, даже если страницу не открывали."
            onChange={(value) => {
              props.write(
                ["sources", "webSearch", "promoteSearchResultsWithoutFetch"],
                value,
              );
            }}
          />
          <NumberField
            label="Ссылок из одного поиска"
            value={sources?.webSearch?.maxPromotedPerSearch ?? 5}
            min={0}
            max={50}
            disabled={blocked}
            hint="0 отключает зачисление ссылок из выдачи."
            onChange={(value) => {
              props.write(
                ["sources", "webSearch", "maxPromotedPerSearch"],
                value,
              );
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Склейка дублей</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={sources?.dedupe?.normalizeUrls ?? true}
            disabled={blocked}
            label="Приводить адреса к общему виду"
            hint="Одинаковые страницы не дублируются."
            onChange={(value) => {
              props.write(["sources", "dedupe", "normalizeUrls"], value);
            }}
          />
          <Toggle
            checked={sources?.dedupe?.stripTrackingParams ?? true}
            disabled={blocked}
            label="Отбрасывать метки переходов"
            hint="utm-метки и подобные параметры не делают ссылку новой."
            onChange={(value) => {
              props.write(["sources", "dedupe", "stripTrackingParams"], value);
            }}
          />
          <Toggle
            checked={sources?.dedupe?.mergeFileRanges ?? true}
            disabled={blocked}
            label="Объединять фрагменты файла"
            hint="Соседние диапазоны одного файла показываются одной записью."
            onChange={(value) => {
              props.write(["sources", "dedupe", "mergeFileRanges"], value);
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Предпросмотр файлов</summary>
        <div className="qa-card-advanced-content">
          <div className="qa-card-grid">
            <Toggle
              checked={filePreview?.enabled ?? true}
              disabled={blocked}
              label="Открывать файлы в панели"
              hint="Источник — только уже попавшие в источники ответа; рабочий каталог чата читается целиком, силами того же предела."
              onChange={(value) => {
                props.write(["sources", "filePreview", "enabled"], value);
              }}
            />
            <Toggle
              checked={filePreview?.markdownRenderedByDefault ?? true}
              disabled={blocked || !(filePreview?.enabled ?? true)}
              label="Markdown сразу размечен"
              hint="Иначе файл открывается как обычный текст."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "markdownRenderedByDefault"],
                  value,
                );
              }}
            />
            <Toggle
              checked={filePreview?.allowRawToggle ?? true}
              disabled={blocked || !(filePreview?.enabled ?? true)}
              label="Переключатель «исходный текст»"
              hint="Позволяет читателю увидеть файл без разметки."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "allowRawToggle"],
                  value,
                );
              }}
            />
            <NumberField
              label="Предел размера файла, байт"
              value={maxBytes}
              min={1_024}
              max={20_000_000}
              disabled={blocked}
              hint={`≈ ${formatCount(Math.round(maxBytes / 1024))} КиБ.`}
              onChange={(value) => {
                props.write(["sources", "filePreview", "maxBytes"], value);
              }}
            />
            <NumberField
              label="Файлов в одном каталоге"
              value={maxListing}
              min={10}
              max={5_000}
              disabled={blocked || !(filePreview?.enabled ?? true)}
              hint="Дольше список — с пометкой, что показаны не все файлы."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "maxListingEntries"],
                  value,
                );
              }}
            />
            <NumberField
              label="Предел разметки, байт"
              value={maxRender}
              min={1_024}
              max={10_000_000}
              disabled={blocked}
              hint="Больший файл откроется текстом; не может превышать предел размера файла."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "maxMarkdownRenderBytes"],
                  value,
                );
              }}
            />
          </div>
          {maxRender > maxBytes ? (
            <Notice tone="warn">
              Предел разметки выше предела размера файла — хост отвергнет такую
              конфигурацию.
            </Notice>
          ) : null}
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Субагенты</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={sources?.subagents?.inheritSources ?? true}
            disabled={blocked}
            label="Наследовать источники"
            hint="Ответ эксперта несёт источник, из которого он работал."
            onChange={(value) => {
              props.write(["sources", "subagents", "inheritSources"], value);
            }}
          />
          <Toggle
            checked={sources?.subagents?.enableReportToolFallback ?? true}
            disabled={blocked}
            label="Запасной канал отчёта"
            hint="Если эксперт не вернул источники сам, они берутся из отчёта."
            onChange={(value) => {
              props.write(
                ["sources", "subagents", "enableReportToolFallback"],
                value,
              );
            }}
          />
          <Toggle
            checked={sources?.subagents?.markIncompleteOpaqueRuns ?? true}
            disabled={blocked}
            label="Помечать неполные прогоны"
            hint="Ход, чьи источники собраны не полностью, честно помечается."
            onChange={(value) => {
              props.write(
                ["sources", "subagents", "markIncompleteOpaqueRuns"],
                value,
              );
            }}
          />
          <Toggle
            checked={sources?.subagents?.validateReportedSources ?? true}
            disabled={blocked}
            label="Проверять источники из отчёта"
            hint="С проверкой принимается только источник с путём или адресом из делегированного прогона. Без неё записывается и «факт» без адреса, и отчёт самого помощника."
            onChange={(value) => {
              props.write(
                ["sources", "subagents", "validateReportedSources"],
                value,
              );
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Совместимость</summary>
        <div className="qa-card-advanced-content">
          <Toggle
            checked={sources?.legacy?.parseAssistantSourcesBlock ?? false}
            disabled={blocked}
            label="Разбирать старый блок источников"
            hint="Совместимость с ответами прежних версий, где список источников приходил текстом."
            onChange={(value) => {
              props.write(
                ["sources", "legacy", "parseAssistantSourcesBlock"],
                value,
              );
            }}
          />
        </div>
      </details>
    </Section>
  );
}
