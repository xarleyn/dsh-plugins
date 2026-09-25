/**
 * The documents settings card.
 *
 * Everything here is the deployment's knobs for the pipeline: whether it is
 * installed at all, which backends it may call, where artifacts land, and how
 * big a document may be. Nothing here is a document operation — those are the
 * five tools, which an allow-list decides about, not this card.
 *
 * The card writes path-addressed mutations into the `documents` settings
 * namespace, so a field the operator clears re-inherits the composition default
 * instead of freezing a copy of today's value.
 */

import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  CardShell,
  bindSettingsExternalStore,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import type { DocumentsConfig } from "../documents/config.js";
import { DEFAULT_DOCUMENTS_CONFIG } from "../documents/defaults.js";
import {
  DOCUMENT_COMPARISON_TOOL_NAMES,
  DOCUMENT_TOOL_NAMES,
} from "../shared/settings.js";
import {
  Facts,
  Grid,
  Notice,
  NumberField,
  Section,
  SelectField,
  TextField,
  Toggle,
} from "./fields.js";

const COMPARISON_MODES: readonly {
  readonly value: "contract" | "default";
  readonly label: string;
}[] = [
  { value: "contract", label: "Контрактный" },
  { value: "default", label: "Обычный" },
];

const PDF_MODES = [
  { value: "auto", label: "Автоматически" },
  { value: "office", label: "Как в Word (DOCX → PDF)" },
  { value: "typst", label: "Typst (нужен движок)" },
] as const;

const EXTRACTION_MODES = [
  { value: "accurate", label: "Точный" },
  { value: "auto", label: "Автоматически" },
  { value: "fast", label: "Быстрый" },
] as const;

const OCR_MODES = [
  { value: "auto", label: "По страницам" },
  { value: "off", label: "Никогда" },
  { value: "force", label: "Всегда" },
] as const;

/** The face the slot entry injects into this card. */
export interface DocumentsCardFace {
  readonly scope: SettingsScope<DocumentsConfig>;
}

type CardProps = PropsRuntime<"settings.plugin.item"> &
  InjectFace<DocumentsCardFace>;

export function DocumentsCard({ scope }: CardProps): ReactElement {
  const store = useMemo(() => bindSettingsExternalStore(scope), [scope]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const config = snapshot.value;
  const writable = snapshot.status === "ready" && snapshot.writable;
  const disabled = !writable;

  /** Write one value; `undefined` clears the field back to the default. */
  const write = useCallback(
    (path: readonly string[], value: unknown) => {
      void scope.mutate([
        value === undefined
          ? { op: "unset" as const, path: [...path] }
          : { op: "set" as const, path: [...path], value: value as never },
      ]);
    },
    [scope],
  );

  /** Whether the user layer carries any of these paths (i.e. has an override). */
  const overridden = useCallback(
    (paths: readonly (readonly string[])[]): boolean =>
      paths.some((path) => readsPath(snapshot.user, path)),
    [snapshot.user],
  );

  const reset = (
    paths: readonly (readonly string[])[],
    testId?: string,
  ): ReactElement | null => {
    const dirty = overridden(paths);
    return (
      <button
        type="button"
        className="dsh-docs-btn link"
        data-testid={testId}
        disabled={disabled || !dirty}
        onClick={() => {
          void scope.mutate(
            paths.map((path) => ({ op: "unset" as const, path: [...path] })),
          );
        }}
      >
        {dirty ? "Сбросить" : "По умолчанию"}
      </button>
    );
  };

  const enabled = config?.enabled ?? DEFAULT_DOCUMENTS_CONFIG.enabled;
  const fieldDisabled = disabled || !enabled;

  return (
    <CardShell
      title="Документы"
      description="Конвейер документов: Markdown ↔ DOCX/PDF, извлечение текста, онлайн-источники."
      badge={
        <span className="dsh-plugin-card__badge">
          {enabled ? "Включён" : "Выключен"}
        </span>
      }
      label={(open) => `${open ? "Скрыть" : "Показать"} настройки: Документы`}
      bodyClassName="dsh-docs-body"
    >
      {snapshot.status === "unavailable" ? (
        <Notice tone="warn" testId="docs-settings-unavailable">
          Раздел настроек недоступен этому браузеру: значения ниже не читаются и
          не записываются.
        </Notice>
      ) : null}

      <Section
        title="Конвейер"
        testId="docs-pipeline"
        reset={reset(
          [["enabled"], ["create", "defaultPdfMode"]],
          "docs-pipeline-reset",
        )}
      >
        <Toggle
          label="Конвейер документов"
          hint="Пять инструментов: создание DOCX/PDF из Markdown, извлечение Markdown, документ по ссылке, конвертация и просмотр структуры. Пока выключено, инструменты не регистрируются."
          testId="docs-pipeline-enabled"
          checked={enabled}
          disabled={disabled}
          onChange={(value) => {
            write(["enabled"], value);
          }}
        />
        <SelectField
          label="PDF по умолчанию"
          testId="docs-pipeline-pdf-mode"
          value={
            config?.create?.defaultPdfMode ??
            DEFAULT_DOCUMENTS_CONFIG.create.defaultPdfMode
          }
          disabled={fieldDisabled}
          options={PDF_MODES}
          hint="«Как в Word» рендерит DOCX и экспортирует его в PDF — оформление совпадает с файлом Word."
          onCommit={(value) => {
            write(["create", "defaultPdfMode"], value);
          }}
        />
      </Section>

      <Section
        title="Извлечение"
        testId="docs-extraction"
        reset={reset(
          [
            ["extraction", "defaultMode"],
            ["extraction", "ocr"],
            ["extraction", "extractImages"],
            ["extraction", "extractTables"],
            ["extraction", "maxInlineChars"],
          ],
          "docs-extraction-reset",
        )}
      >
        <Grid>
          <SelectField
            label="Режим извлечения"
            testId="docs-extraction-mode"
            value={
              config?.extraction?.defaultMode ??
              DEFAULT_DOCUMENTS_CONFIG.extraction.defaultMode
            }
            disabled={fieldDisabled}
            options={EXTRACTION_MODES}
            hint="Точный использует структурный разборщик; быстрый — облегчённый, если он включён."
            onCommit={(value) => {
              write(["extraction", "defaultMode"], value);
            }}
          />
          <SelectField
            label="OCR"
            testId="docs-extraction-ocr"
            value={
              config?.extraction?.ocr ?? DEFAULT_DOCUMENTS_CONFIG.extraction.ocr
            }
            disabled={fieldDisabled}
            options={OCR_MODES}
            hint="Политика распознавания для документов без текстового слоя."
            onCommit={(value) => {
              write(["extraction", "ocr"], value);
            }}
          />
        </Grid>
        <Toggle
          label="Извлекать изображения"
          hint="Найденные картинки сохраняются в папке артефакта, ссылки в Markdown переписываются на них."
          testId="docs-extraction-images"
          checked={
            config?.extraction?.extractImages ??
            DEFAULT_DOCUMENTS_CONFIG.extraction.extractImages
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["extraction", "extractImages"], value);
          }}
        />
        <Toggle
          label="Извлекать таблицы"
          hint="Таблицы разбираются структурно, а не как текст подряд."
          testId="docs-extraction-tables"
          checked={
            config?.extraction?.extractTables ??
            DEFAULT_DOCUMENTS_CONFIG.extraction.extractTables
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["extraction", "extractTables"], value);
          }}
        />
        <NumberField
          label="Символов в ответе"
          testId="docs-extraction-max-chars"
          value={
            config?.extraction?.maxInlineChars ??
            DEFAULT_DOCUMENTS_CONFIG.extraction.maxInlineChars
          }
          min={1_000}
          max={5_000_000}
          disabled={fieldDisabled}
          hint="Сколько извлечённого Markdown возвращается модели. Артефакт всегда хранит весь текст."
          onCommit={(value) => {
            write(["extraction", "maxInlineChars"], value);
          }}
        />
      </Section>

      <Section
        title="Разборщики"
        hint="Основной разбор — Docling; pandoc и LibreOffice рендерят документы. Отсутствие программы видно в логе при старте."
        testId="docs-parsers"
        reset={reset(
          [
            ["docling", "enabled"],
            ["docling", "baseUrl"],
            ["pandoc", "executable"],
            ["libreoffice", "executable"],
            ["markitdown", "enabled"],
            ["markitdown", "executable"],
          ],
          "docs-parsers-reset",
        )}
      >
        <Toggle
          label="Разборщик Docling"
          hint="Основной сервис разбора PDF и DOCX; без него остаётся запасной быстрый разборщик, если он включён."
          testId="docs-parsers-docling"
          checked={
            config?.docling?.enabled ?? DEFAULT_DOCUMENTS_CONFIG.docling.enabled
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["docling", "enabled"], value);
          }}
        />
        <TextField
          label="Адрес Docling"
          testId="docs-parsers-docling-url"
          value={config?.docling?.baseUrl ?? ""}
          placeholder={DEFAULT_DOCUMENTS_CONFIG.docling.baseUrl}
          disabled={
            fieldDisabled ||
            !(
              config?.docling?.enabled ??
              DEFAULT_DOCUMENTS_CONFIG.docling.enabled
            )
          }
          hint="HTTP-сервис docling-serve. Переменная DSH_DOCUMENTS_DOCLING_BASE_URL переопределяет значение при запуске Host."
          onCommit={(value) => {
            write(["docling", "baseUrl"], value.trim());
          }}
        />
        <Grid>
          <TextField
            label="pandoc"
            testId="docs-parsers-pandoc"
            value={config?.pandoc?.executable ?? ""}
            placeholder={DEFAULT_DOCUMENTS_CONFIG.pandoc.executable}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["pandoc", "executable"], value.trim());
            }}
          />
          <TextField
            label="LibreOffice"
            testId="docs-parsers-libreoffice"
            value={config?.libreoffice?.executable ?? ""}
            placeholder={DEFAULT_DOCUMENTS_CONFIG.libreoffice.executable}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["libreoffice", "executable"], value.trim());
            }}
          />
        </Grid>
        <Toggle
          label="Быстрый разборщик (markitdown)"
          hint="Запасной путь, когда Docling недоступен. Требует установленного markitdown."
          testId="docs-parsers-markitdown"
          checked={
            config?.markitdown?.enabled ??
            DEFAULT_DOCUMENTS_CONFIG.markitdown.enabled
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["markitdown", "enabled"], value);
          }}
        />
      </Section>

      <Section
        title="Артефакты"
        hint="Каждая операция складывает исходник, результат, вложения и manifest.json в один каталог."
        testId="docs-artifacts"
        reset={reset(
          [
            ["storage", "root"],
            ["storage", "retainSource"],
            ["storage", "retainInputs"],
            ["retention", "enabled"],
            ["retention", "maxAgeDays"],
          ],
          "docs-artifacts-reset",
        )}
      >
        <TextField
          label="Каталог артефактов"
          testId="docs-artifacts-root"
          value={config?.storage?.root ?? ""}
          placeholder="<рабочая папка сессии>/.qa/artifacts/documents"
          disabled={fieldDisabled}
          hint="Абсолютный путь для общего тома. Пусто — каждая сессия хранит документы в своей рабочей папке."
          onCommit={(value) => {
            write(
              ["storage", "root"],
              value.trim() === "" ? undefined : value.trim(),
            );
          }}
        />
        <Toggle
          label="Хранить исходный Markdown"
          hint="Копия Markdown остаётся рядом с готовыми файлами."
          testId="docs-artifacts-retain-source"
          checked={
            config?.storage?.retainSource ??
            DEFAULT_DOCUMENTS_CONFIG.storage.retainSource
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["storage", "retainSource"], value);
          }}
        />
        <Toggle
          label="Хранить входной файл"
          hint="Загруженный или скачанный документ остаётся в артефакте, а не только его текст."
          testId="docs-artifacts-retain-inputs"
          checked={
            config?.storage?.retainInputs ??
            DEFAULT_DOCUMENTS_CONFIG.storage.retainInputs
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["storage", "retainInputs"], value);
          }}
        />
        <Toggle
          label="Удалять старые документы"
          hint="Уборка работает только при заданном каталоге артефактов: в разложении по сессиям плагин не знает о других рабочих папках."
          testId="docs-artifacts-retention"
          checked={
            config?.retention?.enabled ??
            DEFAULT_DOCUMENTS_CONFIG.retention.enabled
          }
          disabled={fieldDisabled || (config?.storage?.root ?? "") === ""}
          onChange={(value) => {
            write(["retention", "enabled"], value);
          }}
        />
        <NumberField
          label="Хранить, дней"
          testId="docs-artifacts-max-age-days"
          value={
            config?.retention?.maxAgeDays ??
            DEFAULT_DOCUMENTS_CONFIG.retention.maxAgeDays
          }
          min={1}
          max={3_650}
          disabled={
            fieldDisabled ||
            (config?.storage?.root ?? "") === "" ||
            !(
              config?.retention?.enabled ??
              DEFAULT_DOCUMENTS_CONFIG.retention.enabled
            )
          }
          onCommit={(value) => {
            write(["retention", "maxAgeDays"], value);
          }}
        />
      </Section>

      <Section
        title="Шаблоны и лимиты"
        testId="docs-templates"
        reset={reset(
          [
            ["templates", "root"],
            ["templates", "default"],
            ["limits", "maxInputBytes"],
            ["limits", "maxMarkdownChars"],
            ["limits", "maxPages"],
            ["limits", "maxExtractedImages"],
          ],
          "docs-templates-reset",
        )}
      >
        <Grid>
          <TextField
            label="Каталог шаблонов"
            testId="docs-templates-root"
            value={config?.templates?.root ?? ""}
            placeholder="<рабочая папка сессии>/document-templates"
            disabled={fieldDisabled}
            hint="Абсолютный путь; внутри должен лежать manifest.yml со списком шаблонов."
            onCommit={(value) => {
              write(
                ["templates", "root"],
                value.trim() === "" ? undefined : value.trim(),
              );
            }}
          />
          <TextField
            label="Шаблон по умолчанию"
            testId="docs-templates-default"
            value={
              config?.templates?.default ??
              DEFAULT_DOCUMENTS_CONFIG.templates.default
            }
            disabled={fieldDisabled}
            hint="Имя шаблона, который применяется, когда агент не назвал свой."
            onCommit={(value) => {
              write(["templates", "default"], value.trim());
            }}
          />
        </Grid>
        <Grid>
          <NumberField
            label="Максимум входного файла, байт"
            testId="docs-templates-max-input-bytes"
            value={
              config?.limits?.maxInputBytes ??
              DEFAULT_DOCUMENTS_CONFIG.limits.maxInputBytes
            }
            min={1_024}
            max={4_294_967_296}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["limits", "maxInputBytes"], value);
            }}
          />
          <NumberField
            label="Максимум Markdown, символов"
            testId="docs-templates-max-markdown-chars"
            value={
              config?.limits?.maxMarkdownChars ??
              DEFAULT_DOCUMENTS_CONFIG.limits.maxMarkdownChars
            }
            min={1_000}
            max={50_000_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["limits", "maxMarkdownChars"], value);
            }}
          />
        </Grid>
        <Grid>
          <NumberField
            label="Максимум страниц"
            testId="docs-templates-max-pages"
            value={
              config?.limits?.maxPages ??
              DEFAULT_DOCUMENTS_CONFIG.limits.maxPages
            }
            min={1}
            max={100_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["limits", "maxPages"], value);
            }}
          />
          <NumberField
            label="Максимум картинок"
            testId="docs-templates-max-images"
            value={
              config?.limits?.maxExtractedImages ??
              DEFAULT_DOCUMENTS_CONFIG.limits.maxExtractedImages
            }
            min={0}
            max={10_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["limits", "maxExtractedImages"], value);
            }}
          />
        </Grid>
      </Section>

      <Section
        title="Сравнение редакций"
        reset={reset([
          ["comparison", "enabled"],
          ["comparison", "defaultMode"],
          ["comparison", "detectMoves"],
          ["comparison", "includeHeaders"],
          ["comparison", "includeFooters"],
          ["comparison", "includeFootnotes"],
          ["comparison", "includeComments"],
          ["comparison", "ignoreWhitespace"],
          ["comparison", "ignoreFormatting"],
          ["comparison", "maxNodes"],
          ["comparison", "maxChanges"],
          ["comparison", "timeoutMs"],
          ["comparison", "inlineChanges"],
          ["comparison", "pageSize"],
        ])}
      >
        <Toggle
          label="Детерминированное сравнение документов"
          hint="Два инструмента: сравнение двух документов и постраничное чтение изменений. Пока выключено, они не регистрируются, а вызов отвечает отказом."
          checked={
            config?.comparison?.enabled ??
            DEFAULT_DOCUMENTS_CONFIG.comparison.enabled
          }
          disabled={disabled}
          onChange={(value) => {
            write(["comparison", "enabled"], value);
          }}
        />
        <Grid>
          <SelectField
            label="Режим по умолчанию"
            value={
              config?.comparison?.defaultMode ??
              DEFAULT_DOCUMENTS_CONFIG.comparison.defaultMode
            }
            disabled={fieldDisabled}
            options={COMPARISON_MODES}
            hint="«Контрактный» включает верхние и нижние колонтитулы, сноски и комментарии и сворачивает только пробелы и оформление."
            onCommit={(value) => {
              write(["comparison", "defaultMode"], value);
            }}
          />
          <NumberField
            label="Изменений в ответе"
            value={
              config?.comparison?.inlineChanges ??
              DEFAULT_DOCUMENTS_CONFIG.comparison.inlineChanges
            }
            min={0}
            max={1_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["comparison", "inlineChanges"], value);
            }}
          />
          <NumberField
            label="Строк на страницу"
            value={
              config?.comparison?.pageSize ??
              DEFAULT_DOCUMENTS_CONFIG.comparison.defaultLimit
            }
            min={1}
            max={1_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["comparison", "pageSize"], value);
            }}
          />
          <NumberField
            label="Предел времени, мс"
            value={
              config?.comparison?.timeoutMs ??
              DEFAULT_DOCUMENTS_CONFIG.comparison.timeoutMs
            }
            min={1_000}
            max={3_600_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["comparison", "timeoutMs"], value);
            }}
          />
          <NumberField
            label="Максимум блоков"
            value={
              config?.comparison?.maxNodes ??
              DEFAULT_DOCUMENTS_CONFIG.comparison.maxNodes
            }
            min={1}
            max={5_000_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["comparison", "maxNodes"], value);
            }}
          />
          <NumberField
            label="Максимум изменений"
            value={
              config?.comparison?.maxChanges ??
              DEFAULT_DOCUMENTS_CONFIG.comparison.maxChanges
            }
            min={1}
            max={1_000_000}
            disabled={fieldDisabled}
            onCommit={(value) => {
              write(["comparison", "maxChanges"], value);
            }}
          />
        </Grid>
        <Toggle
          label="Отслеживать перемещения"
          hint="Пункт, перенесённый в другой раздел без правок, показывается как перемещение, а не как удаление с добавлением."
          checked={
            config?.comparison?.detectMoves ??
            DEFAULT_DOCUMENTS_CONFIG.comparison.detectMoves
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["comparison", "detectMoves"], value);
          }}
        />
        <Toggle
          label="Верхние и нижние колонтитулы"
          hint="Сравнивать колонтитулы при области «весь документ»."
          checked={
            config?.comparison?.includeHeaders ??
            DEFAULT_DOCUMENTS_CONFIG.comparison.includeHeaders
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["comparison", "includeHeaders"], value);
            write(["comparison", "includeFooters"], value);
          }}
        />
        <Toggle
          label="Сноски и комментарии"
          hint="Сноски и примечания становятся отдельными блоками сравнения."
          checked={
            config?.comparison?.includeFootnotes ??
            DEFAULT_DOCUMENTS_CONFIG.comparison.includeFootnotes
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["comparison", "includeFootnotes"], value);
            write(["comparison", "includeComments"], value);
          }}
        />
        <Toggle
          label="Сравнивать оформление"
          hint="Выключено: различия в начертании не считаются изменением текста."
          checked={
            config?.comparison?.ignoreFormatting ??
            DEFAULT_DOCUMENTS_CONFIG.comparison.ignoreFormatting
          }
          disabled={fieldDisabled}
          onChange={(value) => {
            write(["comparison", "ignoreFormatting"], value);
          }}
        />
        <Notice>
          Числа, проценты, валюты, даты и отрицания не нормализуются никогда.
          Различия находит код, а модель объясняет уже найденное — по
          идентификаторам изменений.
        </Notice>
      </Section>

      <Section title="Инструменты">
        <Facts
          rows={[
            ["Регистрирует", DOCUMENT_TOOL_NAMES.join(", ")],
            [
              "Сравнение",
              `${DOCUMENT_COMPARISON_TOOL_NAMES.join(", ")} — только пока сравнение включено`,
            ],
            [
              "Видимость",
              "инструменты становятся доступны чату только через allow-list развёртывания",
            ],
          ]}
        />
        <Notice>
          Для конвейера нужны pandoc и headless LibreOffice в образе
          развёртывания; PDF и DOCX разбирает Docling. Агент не может передавать
          им свои параметры — командную строку собирает только плагин.
        </Notice>
      </Section>
    </CardShell>
  );
}

/** Whether a stored user layer carries a dotted path. */
function readsPath(user: unknown, path: readonly string[]): boolean {
  let current: unknown = user;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return false;
    current = (current as Record<string, unknown>)[key];
    if (current === undefined) return false;
  }
  return true;
}
