/**
 * Documents: the document pipeline's deployment knobs.
 *
 * Everything here is optional — the defaults are usable as they are — but two
 * of them decide whether the four document tools work at all in a given
 * deployment: the Docling endpoint and the executables the renderer needs.
 * The section therefore shows the effective values the Host resolved, not only
 * what this browser has written.
 */

import {
  Notice,
  NumberField,
  Section,
  SelectField,
  TextField,
  Toggle,
} from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const PDF_MODES = [
  { value: "auto", label: "Автоматически" },
  { value: "office", label: "Как в Word (DOCX → PDF)" },
  { value: "typst", label: "Typst (нужен движок)" },
];

const EXTRACTION_MODES = [
  { value: "accurate", label: "Точный" },
  { value: "auto", label: "Автоматически" },
  { value: "fast", label: "Быстрый" },
];

const OCR_MODES = [
  { value: "auto", label: "По страницам" },
  { value: "off", label: "Никогда" },
  { value: "force", label: "Всегда" },
];

/** Document creation, conversion and extraction. */
export function DocumentsSection(props: ConfigProps) {
  const documents = props.config?.documents;
  const resolved = props.effective?.documents;
  const disabled = !props.writable;
  const paths: SectionPaths = [["documents"]];
  const modified = overriddenAny(props, paths);

  const enabled = documents?.enabled ?? resolved?.enabled ?? true;
  const pdfMode =
    documents?.create?.defaultPdfMode ??
    resolved?.create.defaultPdfMode ??
    "auto";
  const extractionMode =
    documents?.extraction?.defaultMode ??
    resolved?.extraction.defaultMode ??
    "accurate";
  const ocr = documents?.extraction?.ocr ?? resolved?.extraction.ocr ?? "auto";
  const extractImages =
    documents?.extraction?.extractImages ??
    resolved?.extraction.extractImages ??
    true;
  const doclingEnabled =
    documents?.docling?.enabled ?? resolved?.docling.enabled ?? true;
  const doclingUrl =
    documents?.docling?.baseUrl ?? resolved?.docling.baseUrl ?? "";
  const templatesRoot = documents?.templates?.root ?? "";
  const templatesDefault =
    documents?.templates?.default ?? resolved?.templates.default ?? "default";
  const storageRoot = documents?.storage?.root ?? "";
  const retainSource =
    documents?.storage?.retainSource ?? resolved?.storage.retainSource ?? true;
  const retentionEnabled =
    documents?.retention?.enabled ?? resolved?.retention.enabled ?? true;
  const retentionDays =
    documents?.retention?.maxAgeDays ?? resolved?.retention.maxAgeDays ?? 30;

  return (
    <Section
      title="Документы"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <Toggle
        label="Конвейер документов"
        hint="Четыре инструмента: создание DOCX/PDF из Markdown, извлечение Markdown, конвертация и просмотр структуры. Пока выключено, инструменты не регистрируются."
        checked={enabled}
        disabled={disabled}
        onChange={(value) => {
          props.write(["documents", "enabled"], value);
        }}
      />
      <SelectField
        label="PDF по умолчанию"
        value={pdfMode}
        disabled={disabled || !enabled}
        options={PDF_MODES}
        hint="«Как в Word» рендерит DOCX и экспортирует его в PDF — оформление совпадает с файлом Word."
        onChange={(value) => {
          props.write(["documents", "create", "defaultPdfMode"], value);
        }}
      />
      <SelectField
        label="Извлечение Markdown"
        value={extractionMode}
        disabled={disabled || !enabled}
        options={EXTRACTION_MODES}
        hint="Точный режим использует структурный разборщик; быстрый — облегчённый, если он включён в развёртывании."
        onChange={(value) => {
          props.write(["documents", "extraction", "defaultMode"], value);
        }}
      />
      <SelectField
        label="OCR"
        value={ocr}
        disabled={disabled || !enabled}
        options={OCR_MODES}
        hint="Политика распознавания для документов без текстового слоя."
        onChange={(value) => {
          props.write(["documents", "extraction", "ocr"], value);
        }}
      />
      <Toggle
        label="Извлекать изображения"
        hint="Найденные картинки сохраняются в папке артефакта, ссылки в Markdown переписываются на них."
        checked={extractImages}
        disabled={disabled || !enabled}
        onChange={(value) => {
          props.write(["documents", "extraction", "extractImages"], value);
        }}
      />
      <Toggle
        label="Разборщик Docling"
        hint="Основной сервис разбора PDF и DOCX; без него остаётся только запасной быстрый разборщик, если он включён."
        checked={doclingEnabled}
        disabled={disabled || !enabled}
        onChange={(value) => {
          props.write(["documents", "docling", "enabled"], value);
        }}
      />
      <TextField
        label="Адрес Docling"
        value={doclingUrl}
        disabled={disabled || !enabled || !doclingEnabled}
        placeholder="http://docling:5001"
        hint="HTTP-сервис docling-serve. Переменная QA_DOCLING_BASE_URL переопределяет это значение при запуске."
        onChange={(value) => {
          props.write(["documents", "docling", "baseUrl"], value);
        }}
      />
      <TextField
        label="Каталог шаблонов"
        value={templatesRoot}
        disabled={disabled || !enabled}
        placeholder="оставьте пустым: <сессия>/document-templates"
        hint="Абсолютный путь. Внутри должен лежать manifest.yml со списком шаблонов."
        onChange={(value) => {
          if (value.trim() === "")
            props.unset(["documents", "templates", "root"]);
          else props.write(["documents", "templates", "root"], value.trim());
        }}
      />
      <TextField
        label="Шаблон по умолчанию"
        value={templatesDefault}
        disabled={disabled || !enabled}
        placeholder="default"
        hint="Имя шаблона, который применяется, когда агент не назвал свой."
        onChange={(value) => {
          props.write(["documents", "templates", "default"], value);
        }}
      />
      <TextField
        label="Каталог артефактов"
        value={storageRoot}
        disabled={disabled || !enabled}
        placeholder="оставьте пустым: <сессия>/.qa/artifacts/documents"
        hint="Абсолютный путь для общего тома. Пусто — каждая сессия хранит документы в своей рабочей папке."
        onChange={(value) => {
          if (value.trim() === "")
            props.unset(["documents", "storage", "root"]);
          else props.write(["documents", "storage", "root"], value.trim());
        }}
      />
      <Toggle
        label="Хранить исходный Markdown"
        hint="Копия Markdown остаётся рядом с готовыми файлами."
        checked={retainSource}
        disabled={disabled || !enabled}
        onChange={(value) => {
          props.write(["documents", "storage", "retainSource"], value);
        }}
      />
      <Toggle
        label="Удалять старые документы"
        hint="Уборка работает только при заданном каталоге артефактов: в разложении по сессиям поверхность не знает о других рабочих папках."
        checked={retentionEnabled}
        disabled={disabled || !enabled || storageRoot.trim() === ""}
        onChange={(value) => {
          props.write(["documents", "retention", "enabled"], value);
        }}
      />
      <NumberField
        label="Хранить, дней"
        value={retentionDays}
        min={1}
        max={3650}
        disabled={
          disabled || !enabled || !retentionEnabled || storageRoot.trim() === ""
        }
        onChange={(value) => {
          props.write(["documents", "retention", "maxAgeDays"], value);
        }}
      />
      <Notice tone="info">
        Для конвейера нужны pandoc и headless LibreOffice в образе
        развёртывания. Агент не может передавать им свои параметры: командную
        строку собирает только поверхность.
      </Notice>
    </Section>
  );
}
