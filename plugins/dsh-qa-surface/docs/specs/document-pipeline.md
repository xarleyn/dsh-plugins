# QA Surface Document Pipeline — Specification

Status: Draft  
Target: `qa-surface`  
Primary goal: дать агентам безопасный, стабильный и расширяемый механизм создания DOCX/PDF и преобразования DOCX/PDF в Markdown.

---

## 1. Summary

`qa-surface` должен предоставлять агентам единый document pipeline для:

- создания `.docx` из Markdown;
- создания `.pdf` из Markdown;
- одновременного создания DOCX + PDF из одного source;
- преобразования DOCX в Markdown;
- преобразования PDF в Markdown;
- конвертации DOCX → PDF;
- инспекции документа и получения метаданных;
- сохранения source, assets и итоговых артефактов как связанного artifact bundle.

Ключевая идея: **Markdown является каноническим текстовым intermediate representation (IR)** для создаваемых агентом документов.

Агент не должен напрямую вызывать `pandoc`, LibreOffice, Docling, Typst или другие низкоуровневые конвертеры. Вместо этого `qa-surface` предоставляет небольшой семантический API:

- `document_create`
- `document_to_markdown`
- `document_convert`
- `document_inspect`

Конкретные backend'ы должны быть скрыты за provider/adapter layer.

---

# 2. Goals

## 2.1 Functional goals

Система должна позволять агенту:

1. Передать Markdown и получить DOCX.
2. Передать Markdown и получить PDF.
3. Передать Markdown и одновременно получить DOCX + PDF.
4. Передать существующий DOCX и получить Markdown.
5. Передать существующий PDF и получить Markdown.
6. Передать DOCX и получить PDF.
7. Получить структурированные метаданные документа.
8. Использовать шаблоны оформления.
9. Вкладывать изображения и другие assets в создаваемые документы.
10. Получать детерминированный manifest результата.
11. Работать без облачных document APIs.
12. Сохранять обратную совместимость tool API при замене внутренних backend'ов.

## 2.2 Architectural goals

- Низкоуровневые document tools не должны быть доступны агенту напрямую по умолчанию.
- Внешний API должен описывать **намерение**, а не способ реализации.
- Конвертеры должны быть replaceable.
- Сервис должен работать self-hosted.
- Основные runtime-зависимости должны быть изолированы от core `qa-surface`.
- Тяжёлые зависимости желательно держать в отдельном container/service.
- Артефакты должны быть воспроизводимы и трассируемы.
- Ошибки должны возвращаться структурированно.
- Система должна быть пригодна для дальнейшего добавления XLSX/PPTX/HTML/ODT без изменения базовой архитектуры.

---

# 3. Non-goals

Первая версия не обязана поддерживать:

- полноценное редактирование существующего DOCX с сохранением каждого Word-specific объекта;
- round-trip `DOCX → Markdown → DOCX` с pixel-perfect сохранением исходного форматирования;
- редактирование PDF;
- подписывание PDF электронной подписью;
- PDF forms;
- password-protected documents;
- tracked changes Microsoft Word;
- Word comments;
- макросы;
- VBA;
- сложные embedded OLE objects;
- cloud Office 365 / Google Docs integrations;
- совместное редактирование документов;
- полноценный WYSIWYG editor.

---

# 4. Design principles

## 4.1 Semantic tools over command execution

Плохо:

```text
pandoc_exec(...)
libreoffice_exec(...)
docling_exec(...)
```

Хорошо:

```text
document_create(...)
document_to_markdown(...)
document_convert(...)
document_inspect(...)
```

Это позволяет заменить implementation без изменения agent prompts, skills и workflows.

## 4.2 Markdown as canonical source for generated documents

Для документов, создаваемых агентом:

```text
Agent
  ↓
Markdown + metadata + assets
  ↓
Document service
  ├── DOCX
  └── PDF
```

Исходный Markdown должен сохраняться рядом с результатом.

## 4.3 Artifact bundle

Каждая операция создания документа создаёт самостоятельный bundle:

```text
artifact/
├── manifest.json
├── source.md
├── assets/
├── output.docx
└── output.pdf
```

Manifest является источником истины о том:

- каким tool был создан документ;
- каким backend;
- с какими параметрами;
- какие файлы были созданы;
- какой source использовался;
- были ли warnings;
- какой template применялся.

---

# 5. High-level architecture

```text
┌────────────────────┐
│       Agent        │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ qa-surface tools   │
│                    │
│ document_create    │
│ document_convert   │
│ document_to_md     │
│ document_inspect   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────────────┐
│ Document Orchestrator      │
│                            │
│ validation                 │
│ artifact storage           │
│ template resolution        │
│ backend selection          │
│ manifest generation        │
└─────────┬──────────────────┘
          │
          ├───────────────┬────────────────┐
          ▼               ▼                ▼
      Renderer         Converter        Extractor
          │               │                │
       Pandoc        LibreOffice         Docling
          │                                │
          └── Typst optional               └── MarkItDown optional
```

---

# 6. Recommended backend stack

## 6.1 Required MVP components

### Pandoc

Назначение:

- Markdown → DOCX
- Markdown → intermediate formats
- применение reference DOCX
- базовая работа с images/tables/headings/lists/code blocks

### LibreOffice headless

Назначение:

- DOCX → PDF
- при необходимости office-compatible rendering

### Docling

Назначение:

- PDF → Markdown
- DOCX → Markdown
- OCR для scan-like PDF
- извлечение таблиц и структуры

Рекомендуемый deployment:

```text
qa-surface
  │
  ├── local document orchestrator
  │
  └── HTTP
       ↓
    docling-serve
```

## 6.2 Optional backends

### Typst

Использование:

- Markdown → PDF без промежуточного DOCX;
- быстрое и контролируемое PDF rendering;
- advanced PDF templates.

### MarkItDown

Использование:

- fast-mode extraction;
- fallback для простых документов;
- быстрый DOCX/PDF → Markdown, если high-fidelity parsing не нужен.

---

# 7. Conversion matrix

| Input    | Output     | MVP backend                 | Notes                      |
| -------- | ---------- | --------------------------- | -------------------------- |
| Markdown | DOCX       | Pandoc                      | Основной путь              |
| Markdown | PDF        | Pandoc → DOCX → LibreOffice | Default office mode        |
| Markdown | PDF        | Pandoc/Typst                | Optional direct PDF mode   |
| Markdown | DOCX + PDF | Pandoc + LibreOffice        | Рекомендуемый путь         |
| DOCX     | Markdown   | Docling                     | Основной extractor         |
| PDF      | Markdown   | Docling                     | OCR/table support          |
| DOCX     | PDF        | LibreOffice                 | Основной converter         |
| PDF      | DOCX       | Not supported MVP           | Может быть добавлено позже |

---

# 8. Agent-facing tools

## 8.1 `document_create`

Создание одного или нескольких файлов из Markdown.

### Input

```ts
interface DocumentCreateInput {
  content: string;

  filename?: string;

  formats: Array<"docx" | "pdf">;

  template?: string;

  title?: string;

  metadata?: Record<string, string>;

  assets?: Array<{
    id: string;
    path?: string;
    dataRef?: string;
    filename?: string;
    mimeType?: string;
  }>;

  options?: {
    pdfMode?: "office" | "typst" | "auto";
    pageSize?: "A4" | "Letter" | string;
    locale?: string;
    toc?: boolean;
    preserveSource?: boolean;
  };
}
```

### Example

```json
{
  "content": "# Test Report\n\n## Summary\nAll checks passed.",
  "filename": "PROJ-123-test-report",
  "formats": ["docx", "pdf"],
  "template": "qa-report",
  "options": {
    "pdfMode": "office",
    "toc": true
  }
}
```

### Output

```ts
interface DocumentCreateResult {
  artifactId: string;

  source?: {
    path: string;
    mediaType: "text/markdown";
  };

  files: Array<{
    format: "docx" | "pdf";
    path: string;
    mediaType: string;
    size: number;
    sha256: string;
  }>;

  template?: string;

  warnings: DocumentWarning[];

  manifestPath: string;
}
```

---

# 9. `document_to_markdown`

Преобразование документа в Markdown.

## Input

```ts
interface DocumentToMarkdownInput {
  file: string;

  mode?: "auto" | "fast" | "accurate";

  ocr?: "auto" | "off" | "force";

  ocrLanguages?: string[];

  extractImages?: boolean;

  extractTables?: boolean;

  preservePageMarkers?: boolean;

  outputFilename?: string;
}
```

## Backend selection

### `mode=accurate`

```text
DOCX/PDF
  ↓
Docling
  ↓
Markdown
```

### `mode=fast`

```text
DOCX/PDF
  ↓
MarkItDown
  ↓
Markdown
```

если MarkItDown backend включён.

### `mode=auto`

MVP:

```text
PDF  → Docling
DOCX → Docling
```

В дальнейшем:

```text
simple DOCX → MarkItDown
complex DOCX → Docling
PDF → Docling
```

## Output

```ts
interface DocumentToMarkdownResult {
  artifactId: string;

  markdown: string;

  markdownPath: string;

  assets?: Array<{
    path: string;
    mediaType: string;
  }>;

  pages?: number;

  backend: string;

  warnings: DocumentWarning[];

  manifestPath: string;
}
```

---

# 10. `document_convert`

Универсальная file-to-file конвертация поддерживаемых форматов.

## Input

```ts
interface DocumentConvertInput {
  file: string;

  targetFormat: "pdf" | "docx" | "md";

  template?: string;

  options?: {
    pdfMode?: "office" | "typst" | "auto";
    ocr?: "auto" | "off" | "force";
  };
}
```

## MVP routes

```text
DOCX → PDF
DOCX → MD
PDF  → MD
MD   → DOCX
MD   → PDF
```

Неподдерживаемая комбинация должна возвращать `UNSUPPORTED_CONVERSION`, а не пытаться выполнить произвольный shell pipeline.

---

# 11. `document_inspect`

Лёгкая операция без полноценной конвертации.

## Input

```ts
interface DocumentInspectInput {
  file: string;
}
```

## Output

```ts
interface DocumentInspectResult {
  filename: string;

  format: "pdf" | "docx" | "md" | "unknown";

  mediaType: string;

  size: number;

  sha256: string;

  metadata?: {
    title?: string;
    author?: string;
    createdAt?: string;
    modifiedAt?: string;
  };

  structure?: {
    pages?: number;
    headings?: number;
    tables?: number;
    images?: number;
  };

  encrypted?: boolean;

  warnings: DocumentWarning[];
}
```

---

# 12. Templates

## 12.1 Template layout

```text
templates/
├── docx/
│   ├── default.docx
│   ├── qa-report.docx
│   ├── test-plan.docx
│   ├── bug-report.docx
│   └── release-report.docx
│
├── typst/
│   ├── default/
│   └── qa-report/
│
└── manifest.yml
```

## 12.2 Template registry

```yaml
templates:
  default:
    docx: ./docx/default.docx

  qa-report:
    docx: ./docx/qa-report.docx
    typst: ./typst/qa-report

  test-plan:
    docx: ./docx/test-plan.docx
```

## 12.3 Resolution

Если template не указан:

```text
requested template
  ↓
project default
  ↓
global default
```

Если template указан, но отсутствует:

- операция завершается ошибкой `TEMPLATE_NOT_FOUND`;
- silent fallback запрещён по умолчанию.

---

# 13. DOCX generation

Recommended command internally:

```bash
pandoc source.md \
  --from=gfm \
  --to=docx \
  --reference-doc=/templates/docx/qa-report.docx \
  --resource-path=/artifact/assets \
  --output=/artifact/output.docx
```

Дополнительные параметры должны добавляться orchestrator'ом, а не агентом.

Агент не должен иметь возможность передать произвольные Pandoc CLI arguments.

---

# 14. PDF generation

## 14.1 Office mode

Default при:

- одновременном запросе DOCX + PDF;
- необходимости одинакового оформления;
- использовании DOCX reference template.

Pipeline:

```text
source.md
   ↓
Pandoc
   ↓
output.docx
   ↓
LibreOffice headless
   ↓
output.pdf
```

Пример внутреннего вызова:

```bash
libreoffice \
  --headless \
  --convert-to pdf \
  --outdir /artifact \
  /artifact/output.docx
```

## 14.2 Typst mode

Optional:

```text
Markdown
  ↓
Pandoc/Typst
  ↓
PDF
```

Используется:

- если нужен только PDF;
- если project template реализован в Typst;
- если office rendering не требуется.

## 14.3 Auto mode

Рекомендуемая логика:

```text
formats contains docx + pdf
    → office

formats = pdf only AND template has typst version
    → typst

otherwise
    → office
```

---

# 15. PDF/DOCX → Markdown

## 15.1 Docling

Docling является default extractor.

Особенно важные возможности:

- layout-aware PDF parsing;
- OCR;
- table extraction;
- document structure;
- images;
- Markdown export.

## 15.2 OCR policy

### `ocr=off`

OCR никогда не запускается.

### `ocr=force`

OCR применяется независимо от наличия text layer.

### `ocr=auto`

Рекомендуемая эвристика:

1. Проверить наличие text layer.
2. Проверить объём извлекаемого текста.
3. Если документ выглядит scan-like — включить OCR.
4. Добавить warning в manifest:

```json
{
  "code": "OCR_USED",
  "message": "Document was processed using OCR."
}
```

---

# 16. Markdown normalization

Extracted Markdown должен проходить normalization layer.

Задачи normalization:

- нормализовать line endings;
- удалить очевидные parser artifacts;
- сохранить heading hierarchy;
- сохранить Markdown tables;
- нормализовать image paths;
- по возможности убрать повторяющиеся headers/footers PDF;
- не пытаться угадывать отсутствующий content;
- не изменять смысл извлечённого текста.

Опциональная LLM normalization может быть добавлена позже, но должна быть отдельной явно включаемой стадией.

Нельзя автоматически отправлять документ в LLM только для "улучшения" Markdown.

---

# 17. Assets

## 17.1 Generated documents

Markdown может ссылаться на:

```md
![Screenshot](assets/login-error.png)
```

Перед conversion orchestrator должен убедиться, что:

- asset существует;
- path находится внутри разрешённого artifact/workspace scope;
- MIME type разрешён;
- path traversal отсутствует.

## 17.2 Extracted documents

При `extractImages=true`:

```text
artifact/
├── document.md
└── assets/
    ├── image-001.png
    └── image-002.jpeg
```

Markdown:

```md
![Image](assets/image-001.png)
```

---

# 18. Artifact storage

Recommended layout:

```text
.qa/
└── artifacts/
    └── documents/
        └── <artifact-id>/
            ├── manifest.json
            ├── source.md
            ├── input/
            │   └── original.pdf
            ├── assets/
            ├── output.docx
            ├── output.pdf
            └── extracted.md
```

Artifact ID:

```text
doc_<ULID>
```

Например:

```text
doc_01K51GQ7V18R3PQ9J11A87AVFB
```

---

# 19. Manifest

Пример:

```json
{
  "schemaVersion": 1,
  "artifactId": "doc_01K51GQ7V18R3PQ9J11A87AVFB",
  "operation": "document_create",
  "createdAt": "2026-09-14T10:00:00Z",

  "input": {
    "format": "markdown",
    "sha256": "..."
  },

  "outputs": [
    {
      "format": "docx",
      "path": "output.docx",
      "sha256": "...",
      "size": 42813
    },
    {
      "format": "pdf",
      "path": "output.pdf",
      "sha256": "...",
      "size": 81392
    }
  ],

  "template": "qa-report",

  "backends": {
    "docx": {
      "provider": "pandoc",
      "version": "..."
    },
    "pdf": {
      "provider": "libreoffice",
      "version": "..."
    }
  },

  "warnings": []
}
```

---

# 20. Configuration

Recommended YAML:

```yaml
documents:
  enabled: true

  storage:
    root: ${DSH_HOME}/qa-surface/artifacts/documents
    retainSource: true
    retainInputs: true

  templates:
    root: ${DSH_HOME}/qa-surface/templates
    default: default

  create:
    defaultPdfMode: auto
    allowFormats:
      - docx
      - pdf

  extraction:
    provider: docling
    defaultMode: accurate
    ocr: auto
    extractImages: true
    extractTables: true

  docling:
    baseUrl: http://docling:5001
    timeoutMs: 120000

  pandoc:
    executable: pandoc
    timeoutMs: 60000

  libreoffice:
    executable: libreoffice
    timeoutMs: 120000

  typst:
    enabled: false
    executable: typst

  markitdown:
    enabled: false

  limits:
    maxInputBytes: 52428800
    maxMarkdownChars: 5000000
    maxPages: 1000
    maxExtractedImages: 500
```

Environment overrides:

```text
QA_DOCUMENTS_ENABLED=true
QA_DOCUMENTS_STORAGE_ROOT=...
QA_DOCLING_BASE_URL=http://docling:5001
QA_DOCUMENTS_MAX_INPUT_BYTES=52428800
```

---

# 21. Docker deployment

Рекомендуется не устанавливать весь document stack непосредственно в основной runtime `qa-surface`, если это заметно увеличивает image.

Пример:

```yaml
services:
  qa-surface:
    image: qa-surface
    environment:
      QA_DOCLING_BASE_URL: http://docling:5001
    volumes:
      - qa_documents:/data/documents
      - ./templates:/data/templates:ro

  docling:
    image: <docling-serve-image>
    volumes:
      - qa_documents:/data/documents

volumes:
  qa_documents:
```

Pandoc + LibreOffice можно:

### Option A — разместить в qa-surface image

Плюсы:

- проще orchestration;
- нет дополнительного RPC.

Минусы:

- тяжелее image.

### Option B — отдельный document-renderer service

```text
qa-surface
  ├── docling
  └── document-renderer
          ├── pandoc
          ├── libreoffice
          └── typst
```

Предпочтительно, если `qa-surface` должен оставаться лёгким.

---

# 22. Internal provider interfaces

```ts
interface DocxRenderer {
  render(input: RenderInput): Promise<RenderedArtifact>;
}

interface PdfRenderer {
  render(input: RenderInput): Promise<RenderedArtifact>;
}

interface DocumentExtractor {
  supports(format: DocumentFormat): boolean;

  extract(input: ExtractInput): Promise<ExtractedDocument>;
}

interface DocumentConverter {
  supports(source: DocumentFormat, target: DocumentFormat): boolean;

  convert(input: ConvertInput): Promise<ConvertedDocument>;
}
```

Concrete implementations:

```text
PandocDocxRenderer
LibreOfficePdfConverter
TypstPdfRenderer
DoclingExtractor
MarkItDownExtractor
```

---

# 23. Backend registry

```ts
const registry = {
  renderers: {
    docx: ["pandoc"],

    pdf: ["libreoffice", "typst"],
  },

  extractors: {
    pdf: ["docling", "markitdown"],

    docx: ["docling", "markitdown"],
  },
};
```

Tool implementation не должен импортировать конкретный backend напрямую.

---

# 24. Error model

Все document tools возвращают structured error:

```ts
interface DocumentError {
  code: string;

  message: string;

  retryable: boolean;

  backend?: string;

  details?: Record<string, unknown>;
}
```

Required codes:

```text
INVALID_INPUT
UNSUPPORTED_FORMAT
UNSUPPORTED_CONVERSION
INPUT_TOO_LARGE
DOCUMENT_TOO_LARGE
FILE_NOT_FOUND
TEMPLATE_NOT_FOUND
INVALID_TEMPLATE
INVALID_ASSET
PATH_NOT_ALLOWED
ENCRYPTED_DOCUMENT
OCR_FAILED
EXTRACTION_FAILED
RENDER_FAILED
CONVERSION_FAILED
BACKEND_UNAVAILABLE
BACKEND_TIMEOUT
ARTIFACT_WRITE_FAILED
```

Backend stderr нельзя возвращать агенту целиком без sanitization.

---

# 25. Warnings

Warnings не должны превращать успешную операцию в failure.

Примеры:

```text
OCR_USED
TABLE_EXTRACTION_DEGRADED
UNSUPPORTED_EMBEDDED_OBJECT
FONT_SUBSTITUTED
IMAGE_SKIPPED
PAGE_LIMIT_REACHED
METADATA_PARTIALLY_EXTRACTED
```

---

# 26. Security

## 26.1 No arbitrary CLI arguments

Агент не может передавать:

```text
--lua-filter
--resource-path arbitrary
--template arbitrary-path
--pdf-engine-opt arbitrary
```

CLI arguments генерируются только trusted orchestrator'ом.

## 26.2 Path containment

Все paths должны быть resolved и проверены:

```text
resolvedPath.startsWith(allowedRoot)
```

Необходимо блокировать:

```text
../../etc/passwd
/sensitive/path
file:///...
```

если путь находится вне разрешённого scope.

## 26.3 File types

Определять формат по нескольким сигналам:

- extension;
- MIME;
- magic bytes.

Не доверять extension как единственному источнику.

## 26.4 Resource limits

Ограничить:

- размер input;
- число страниц;
- число assets;
- timeout;
- output size;
- concurrency;
- OCR concurrency.

## 26.5 Network isolation

Document backend не должен иметь unrestricted internet access, если он ему не нужен.

Особенно важно для обработки потенциально недоверенных документов.

## 26.6 Macros

DOCM и другие macro-enabled office documents:

- не исполнять;
- по умолчанию отклонять либо обрабатывать только как passive content;
- возвращать warning/error.

---

# 27. Concurrency

Document conversions могут быть CPU/RAM intensive.

Orchestrator должен иметь queue.

Пример config:

```yaml
documents:
  workers:
    renderConcurrency: 2
    extractionConcurrency: 2
    ocrConcurrency: 1
```

Для больших deployment возможен отдельный job queue.

MVP допускает in-process semaphore.

---

# 28. Timeouts

Suggested defaults:

```text
Pandoc:       60 sec
LibreOffice: 120 sec
Docling:     120 sec
OCR:         300 sec
```

Timeout должен возвращать:

```text
BACKEND_TIMEOUT
```

и завершать child process/container request.

---

# 29. Observability

Для каждой операции желательно писать:

## Metrics

```text
qa_document_operations_total
qa_document_operation_duration_seconds
qa_document_operation_errors_total
qa_document_bytes_processed_total
qa_document_pages_processed_total
qa_document_ocr_operations_total
```

Labels:

```text
operation
input_format
output_format
backend
status
```

Не использовать filename/user content как metric labels.

## Traces

Span:

```text
document.create
document.convert
document.extract
```

Child spans:

```text
pandoc.render
libreoffice.convert
docling.extract
artifact.write
```

## Logs

Логировать:

- artifact ID;
- backend;
- duration;
- input size;
- output size;
- status;
- normalized error code.

Не логировать полный текст документа по умолчанию.

---

# 30. Cache

Опционально после MVP.

Cache key:

```text
SHA256(
  input SHA256
  + operation
  + backend
  + backend version
  + template SHA256
  + normalized options
)
```

Это позволит не повторять одинаковые expensive conversions.

---

# 31. Determinism

Полная byte-level determinism DOCX/PDF не гарантируется, поскольку backend может записывать timestamps/metadata.

Но logical reproducibility должна поддерживаться через manifest:

- input hash;
- template hash;
- backend;
- backend version;
- options.

---

# 32. File naming

User filename нужно sanitize.

Input:

```text
../../foo report?.docx
```

Output:

```text
foo-report.docx
```

Если filename отсутствует:

```text
document-<short-artifact-id>.docx
```

---

# 33. Agent UX

Агент должен работать на уровне намерения.

Пример:

```text
Создай QA report в Word и PDF.
```

Agent:

```json
{
  "content": "...",
  "formats": ["docx", "pdf"],
  "template": "qa-report"
}
```

Agent не должен рассуждать:

```text
сначала запущу pandoc,
потом libreoffice,
потом найду output...
```

Это implementation detail сервиса.

---

# 34. Recommended tool descriptions

## document_create

> Create DOCX and/or PDF documents from Markdown content using managed document templates. Use this instead of invoking document conversion binaries directly.

## document_to_markdown

> Extract a DOCX or PDF into Markdown. Supports structured extraction, tables, images and OCR when required.

## document_convert

> Convert a supported document to another supported document format using the managed document pipeline.

## document_inspect

> Inspect document type, metadata and basic structure without converting it.

---

# 35. Markdown feature subset

MVP должен гарантированно поддерживать:

- headings;
- paragraphs;
- bold/italic;
- ordered lists;
- unordered lists;
- task lists where possible;
- blockquotes;
- fenced code blocks;
- inline code;
- links;
- images;
- tables;
- horizontal rules;
- page breaks via controlled extension;
- frontmatter metadata.

Extended custom syntax желательно избегать.

---

# 36. Controlled document directives

При необходимости можно добавить безопасные extension directives.

Например:

```md
:::pagebreak
:::
```

или:

```md
:::note
Important information.
:::
```

Orchestrator preprocessing преобразует их в backend-specific representation.

Не следует позволять произвольный raw LaTeX/HTML/Typst без отдельной настройки.

---

# 37. QA-specific templates

Recommended initial templates:

```text
default
qa-report
test-plan
test-run-report
bug-report
release-report
investigation-report
```

## qa-report suggested sections

```text
Title
Metadata
Executive Summary
Scope
Environment
Results
Failed Checks
Evidence
Known Issues
Conclusion
```

Это template-level convention, а не обязательная структура `document_create`.

---

# 38. Suggested repository structure

Если capability находится непосредственно внутри `qa-surface`:

```text
src/
├── documents/
│   ├── index.ts
│   ├── config.ts
│   ├── types.ts
│   ├── errors.ts
│   │
│   ├── tools/
│   │   ├── create.ts
│   │   ├── convert.ts
│   │   ├── to-markdown.ts
│   │   └── inspect.ts
│   │
│   ├── orchestrator/
│   │   ├── create-document.ts
│   │   ├── convert-document.ts
│   │   ├── extract-document.ts
│   │   └── inspect-document.ts
│   │
│   ├── providers/
│   │   ├── pandoc/
│   │   ├── libreoffice/
│   │   ├── docling/
│   │   ├── typst/
│   │   └── markitdown/
│   │
│   ├── artifacts/
│   │   ├── store.ts
│   │   └── manifest.ts
│   │
│   ├── templates/
│   │   ├── registry.ts
│   │   └── resolver.ts
│   │
│   └── security/
│       ├── paths.ts
│       ├── file-types.ts
│       └── limits.ts
│
└── ...
```

Templates отдельно:

```text
assets/
└── document-templates/
    ├── manifest.yml
    ├── docx/
    └── typst/
```

---

# 39. Alternative: standalone service

Если dependency footprint становится слишком большим:

```text
packages/
├── qa-surface/
└── qa-document-service/
```

`qa-document-service` предоставляет внутренний API:

```text
POST /v1/documents
POST /v1/conversions
POST /v1/extractions
POST /v1/inspect
GET  /v1/artifacts/:id
```

Плюсы:

- изоляция LibreOffice;
- независимое масштабирование OCR;
- проще обновлять document dependencies;
- qa-surface остаётся лёгким.

Минусы:

- дополнительный HTTP layer;
- distributed failure modes;
- auth/service discovery.

Рекомендация:

- начать с internal module + отдельного Docling;
- вынести renderer в отдельный service только при необходимости.

---

# 40. API authorization

Document tools наследуют authorization context `qa-surface`.

Artifact должен быть привязан минимум к:

```text
workspace / project
session
operation
```

Если в qa-surface есть multi-user mode:

```text
owner / tenant
```

обязательны.

Один workspace не должен иметь возможность читать artifact другого workspace без явной политики.

---

# 41. Cleanup and retention

Config:

```yaml
documents:
  retention:
    enabled: true
    maxAgeDays: 30
    cleanupIntervalHours: 12
```

Варианты:

- ephemeral artifacts;
- session lifetime;
- project lifetime;
- permanent/manual.

MVP default рекомендуется сделать project-scoped persistent artifact storage.

---

# 42. Health checks

Orchestrator должен проверять backend availability.

Endpoint/internal check:

```text
document backends:
  pandoc: ok
  libreoffice: ok
  docling: ok
  typst: disabled
```

Отсутствие optional backend не делает subsystem unhealthy.

Например:

```json
{
  "status": "degraded",
  "required": {
    "pandoc": "ok",
    "libreoffice": "ok",
    "docling": "unavailable"
  },
  "optional": {
    "typst": "disabled",
    "markitdown": "disabled"
  }
}
```

---

# 43. Feature capability discovery

Agent/runtime должен иметь возможность узнать capability:

```json
{
  "create": ["docx", "pdf"],
  "extract": ["docx", "pdf"],
  "convert": [
    ["docx", "pdf"],
    ["docx", "md"],
    ["pdf", "md"],
    ["md", "docx"],
    ["md", "pdf"]
  ],
  "ocr": true,
  "templates": ["default", "qa-report", "test-plan"]
}
```

Это полезно для UI и будущих integrations.

---

# 44. UI considerations

Не обязательно для MVP, но архитектура должна позволять UI показать:

- созданные artifacts;
- preview;
- download/open actions;
- source Markdown;
- используемый template;
- conversion status;
- warnings;
- "Convert to Markdown";
- "Create Word";
- "Create PDF";
- "Create Word + PDF".

Желательно не отображать внутренние backend names как основную UX abstraction.

---

# 45. Failure scenarios

## Docling unavailable

`document_to_markdown`:

```text
BACKEND_UNAVAILABLE
backend=docling
retryable=true
```

Если MarkItDown включён и policy разрешает fallback:

```text
Docling unavailable
    ↓
MarkItDown
    ↓
warning BACKEND_FALLBACK_USED
```

Fallback должен быть виден в manifest.

## LibreOffice crash

- child process уничтожается;
- temp profile удаляется;
- operation возвращает `CONVERSION_FAILED`;
- исходный DOCX сохраняется, если он уже был успешно создан.

Partial success разрешён.

Пример:

```json
{
  "files": [
    {
      "format": "docx",
      "status": "created"
    },
    {
      "format": "pdf",
      "status": "failed"
    }
  ]
}
```

---

# 46. LibreOffice isolation

Для параллельной работы желательно отдельный temporary user profile:

```text
-env:UserInstallation=file:///tmp/lo-profile-<job-id>
```

Это снижает риск конфликтов concurrent headless conversions.

Temp profiles должны удаляться после выполнения.

---

# 47. Temporary files

Все temp files создаются внутри job-scoped temp directory:

```text
/tmp/qa-documents/<job-id>/
```

После success/failure:

```text
cleanup()
```

Temp directory никогда не используется как долговременное artifact storage.

---

# 48. Test strategy

## 48.1 Unit tests

Проверить:

- format routing;
- filename sanitization;
- path containment;
- template resolution;
- manifest generation;
- cache key;
- backend selection;
- timeout mapping;
- error mapping.

## 48.2 Integration tests

### Markdown → DOCX

Проверить:

- headings;
- tables;
- images;
- code blocks;
- template;
- metadata.

### Markdown → PDF

Проверить:

- файл открывается;
- page count > 0;
- text присутствует;
- images присутствуют.

### DOCX → Markdown

Проверить:

- headings;
- paragraphs;
- lists;
- tables.

### PDF → Markdown

Тесты:

- text PDF;
- scanned PDF;
- tables;
- multi-page;
- images.

## 48.3 Golden fixtures

```text
test/fixtures/documents/
├── simple.md
├── tables.md
├── images.md
├── simple.docx
├── complex.docx
├── text.pdf
├── scanned.pdf
└── tables.pdf
```

Не стоит делать byte-for-byte comparison PDF/DOCX.

Лучше проверять:

- structure;
- extracted text;
- metadata;
- наличие expected elements.

## 48.4 Security tests

Обязательно:

```text
path traversal
symlink escape
oversized input
fake extension
malformed DOCX
malformed PDF
encrypted PDF
macro-enabled DOCM
conversion timeout
fork bomb-like payload protections
```

---

# 49. Acceptance criteria

MVP считается готовым, если:

1. Агент может передать Markdown и получить валидный DOCX.
2. Агент может передать Markdown и получить валидный PDF.
3. Агент может одним вызовом получить DOCX + PDF.
4. DOCX можно преобразовать в читаемый Markdown.
5. Text PDF можно преобразовать в читаемый Markdown.
6. Scanned PDF может быть обработан OCR.
7. DOCX можно конвертировать в PDF.
8. Все generated artifacts имеют manifest.
9. Path traversal блокируется.
10. Agent не может передавать arbitrary CLI flags.
11. Внешний tool API не зависит от Pandoc/LibreOffice/Docling.
12. Errors имеют стабильные codes.
13. Конвертация работает в Docker/self-hosted deployment.
14. Для каждого artifact сохраняется source/input hash.
15. Есть integration tests для основных маршрутов.

---

# 50. Implementation phases

## Phase 1 — Core interfaces

Реализовать:

- types;
- error model;
- artifact store;
- manifest;
- template registry;
- backend interfaces;
- config.

## Phase 2 — Markdown → DOCX

Добавить:

- Pandoc provider;
- `document_create`;
- DOCX templates;
- assets.

## Phase 3 — DOCX → PDF

Добавить:

- LibreOffice provider;
- office PDF mode;
- temp profile isolation;
- partial success.

## Phase 4 — PDF/DOCX → Markdown

Добавить:

- Docling client;
- `document_to_markdown`;
- OCR;
- extracted assets.

## Phase 5 — Generic conversion + inspect

Добавить:

- `document_convert`;
- `document_inspect`;
- capability discovery.

## Phase 6 — Hardening

Добавить:

- limits;
- security tests;
- timeouts;
- concurrency control;
- health checks;
- observability.

## Phase 7 — Optional enhancements

Добавить при необходимости:

- Typst;
- MarkItDown;
- caching;
- preview UI;
- artifact management UI;
- async jobs;
- queue;
- additional formats.

---

# 51. Recommended MVP

Минимальный production-worthy вариант:

```text
Pandoc
LibreOffice headless
Docling Serve
```

Agent-facing API:

```text
document_create
document_to_markdown
document_convert
document_inspect
```

Supported flows:

```text
Markdown → DOCX
Markdown → PDF
Markdown → DOCX + PDF
DOCX → PDF
DOCX → Markdown
PDF → Markdown
```

Storage:

```text
artifact bundle + manifest
```

Deployment:

```text
qa-surface
    │
    ├── Pandoc
    ├── LibreOffice
    │
    └──── HTTP ────► Docling Serve
```

Если размер основного image станет проблемой, Pandoc + LibreOffice можно вынести в отдельный `qa-document-service`, сохранив тот же agent-facing API.

---

# 52. Future extensions

Архитектура должна позволять позже добавить:

```text
Markdown → HTML
HTML → PDF
Markdown → ODT
PPTX → Markdown
XLSX → Markdown
Markdown → PPTX
Markdown → XLSX
```

Новые форматы добавляются через provider interfaces и conversion registry, без изменения принципов agent-facing API.

---

# 53. Final architecture decision

Для `qa-surface` рекомендуется:

1. Использовать Markdown как canonical source для generated documents.
2. Скрыть document backend'ы за semantic tools.
3. Использовать Pandoc для Markdown → DOCX.
4. Использовать LibreOffice headless для DOCX → PDF.
5. Использовать Docling как default DOCX/PDF → Markdown extractor.
6. Оставить Typst и MarkItDown optional providers.
7. Хранить source/input/output в artifact bundle.
8. Генерировать manifest для каждого document job.
9. Не разрешать агенту arbitrary CLI arguments.
10. Сохранить provider abstraction, чтобы backend можно было заменить без изменения agent prompts/tools.

Эта схема должна быть базовой архитектурой document subsystem `qa-surface`.
