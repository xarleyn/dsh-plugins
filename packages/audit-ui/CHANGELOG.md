## 0.1.0 (2026-09-18)

### 🚀 Features

- Initial release: the shared audit presentation layer. ([0573d64](https://github.com/xarleyn/dsh-plugins/commit/0573d64))

  The components render an audit they are handed. They never fetch, never
  subscribe, and never import a DSH client package, which is what lets a full
  conversation page and a modal dialog share them: the shell differs, the content
  does not. That split is the reason the session-audit plugin and the QA Surface
  can show the same audit record without either one owning it.

  The package ships its own report renderer rather than borrowing a plugin's,
  because an audit report is untrusted text — a model wrote it — and the
  guarantees that make it safe to render belong next to the code that relies on
  them. Raw HTML has no path to the DOM at all: a tag line is a paragraph whose
  inline text leaves the tag as characters, and there is no `innerHTML` anywhere
  in the package. Link and image destinations pass a protocol allowlist, so
  `javascript:` and `data:` are text rather than a click target, and a refused
  image degrades to its alt text instead of disappearing.

  The report format depends on tables, so the parser is GFM: headings become the
  table of contents with matching anchors, and tables, nested lists, task items,
  blockquotes, fenced code and inline code all render. A construct the grammar
  does not recognise stays visible as text, so an unexpected report never loses
  content. The findings list groups by severity, most severe first, and a
  severity this build does not know gets its own group under the producer's own
  word rather than being dropped or silently reclassified.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-audit-core to 0.1.0

### ❤️ Thank You

- xarleyn @xarleyn