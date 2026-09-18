/**
 * `@yadsh/dsh-audit-ui` — the shared audit presentation layer.
 *
 * The components here render an audit they were handed. They never fetch, never
 * subscribe to anything, and never import a DSH client package, which is what
 * lets a full conversation page and a modal dialog share them (SPEC §51): the
 * shell differs, the content does not.
 *
 * The markdown renderer is part of this package rather than borrowed from a
 * plugin, because an audit report is untrusted text (a model wrote it) and the
 * guarantees that make it safe to render — no raw HTML path at all, a protocol
 * allowlist for link and image destinations — belong next to the code that
 * relies on them.
 */
export {
  AuditBetterTrajectory,
  AuditEmptyState,
  AuditErrorState,
  AuditFindingCard,
  AuditFindings,
  AuditLimitations,
  AuditMissedOpportunities,
  AuditRecommendations,
  AuditReport,
  AuditScorecard,
  AuditStatusBadge,
  AuditStatusBar,
  AuditTabs,
  type AuditStatusBarProps,
} from "./components/index.js";

export {
  AuditJsonTree,
  type AuditJsonTreeProps,
} from "./json/AuditJsonTree.js";

export {
  headingAnchor,
  parseReport,
  renderMarkdown,
  renderReport,
  safeHref,
  type MarkdownHeading,
  type ParsedReport,
} from "./markdown/render.js";
export {
  parseBlocks,
  type HeadingDepth,
  type MarkdownBlock,
  type MarkdownListItem,
  type TableAlign,
} from "./markdown/blocks.js";
export { parseInline, type InlineNode } from "./markdown/inline.js";

export {
  evidenceLabel,
  findingsLabel,
  formatCount,
  formatTimestamp,
  outcomeLabel,
  verdictLabel,
  verdictTone,
} from "./format.js";

export { AUDIT_UI_STYLES } from "./styles.js";
