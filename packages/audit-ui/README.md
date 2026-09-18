# @yadsh/dsh-audit-ui

Shared presentation components for session audits: the report renderer, the
findings list, the scorecard, the status bar, the JSON view and the tab strip.

The components render an audit they were handed. They never fetch, never
subscribe, and never import a DSH client package — which is what lets a full
conversation page and a modal dialog share them. The shell differs, the content
does not.

## Install

```bash
pnpm add @yadsh/dsh-audit-ui
```

## Use

```tsx
import {
  AUDIT_UI_STYLES,
  AuditFindings,
  AuditJsonTree,
  AuditReport,
  AuditStatusBar,
  AuditTabs,
} from "@yadsh/dsh-audit-ui";

<AuditStatusBar
  verdict={summary.verdict}
  outcomeStatus={summary.outcomeStatus}
  evidenceLevel={summary.evidenceLevel}
  findings={summary.findings}
/>

<AuditTabs tabs={tabs} active={tab} onSelect={setTab} />

<AuditReport markdown={report} />
<AuditFindings findings={analysis.findings} />
<AuditJsonTree value={raw} />
```

The stylesheet is an exported string so both consumers inject it identically:
append `AUDIT_UI_STYLES` to a `<style>` element, or fold it into an
application's own sheet.

## What the components guarantee

An audit report is untrusted text — a model wrote it — and the renderer is
built around that:

- **Raw HTML has no path to the DOM.** There is no `innerHTML` in this package,
  and no HTML parser. A tag line is a paragraph whose inline pass leaves the tag
  as characters.
- **Destinations pass a protocol allowlist.** `http`, `https` and `mailto` are
  links; `javascript:`, `data:` and relative targets are text. An image that
  fails the allowlist degrades to its alt text rather than disappearing.
- **Nothing is dropped.** A construct the grammar does not recognise stays
  visible as text, so an unexpected report never loses content.

The report format depends on tables, so the parser is GFM: headings with stable
anchors and a table of contents, tables with column alignment, nested and
ordered lists, task items, blockquotes, fenced code and inline code, links,
images, emphasis and strikethrough.

Two more decisions worth knowing:

- **An unknown severity gets its own group** in the findings list, under the
  producer's own word, rather than being dropped or silently reclassified. The
  groups are ordered most-severe-first.
- **The JSON view's filter prunes** rather than highlights: a search that still
  showed every non-matching row would be a highlighter carrying the tree's cost.
  Above roughly half a megabyte the tree gives way to raw text, because walking
  it would cost more than it shows.

## Compatibility

- React `^18.2.0`.
- Node.js `^22.19.0` or `>=24.0.0` (for the build and for server-side render).

## Development

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## License

MIT
