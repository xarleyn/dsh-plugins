/**
 * The shared audit components.
 *
 * Each one renders a piece of an audit it was handed; none of them fetches,
 * subscribes, or knows whether it is inside a full conversation page or a
 * dialog (SPEC §10, §51). Layout is the caller's business, which is why there
 * is no single `AuditViewer` here.
 */
import type { ReactNode } from "react";
import type {
  AuditAnalysisV1,
  AuditFinding,
  AuditRecommendation,
  AuditScorecard,
} from "@yadsh/dsh-audit-core";
import {
  normalizeConfidence,
  normalizePriority,
  normalizeSeverity,
  normalizeVerdict,
  severityRank,
  totalFindings,
} from "@yadsh/dsh-audit-core";
import {
  evidenceLabel,
  findingsLabel,
  formatCount,
  formatTimestamp,
  outcomeLabel,
  verdictLabel,
  verdictTone,
} from "../format.js";
import { parseReport, renderReport } from "../markdown/render.js";

/** The compact badge: a check mark and the word, nothing more. */
export function AuditStatusBadge(props: {
  readonly label?: string;
  readonly title?: string;
}): ReactNode {
  return (
    <span
      className="dsh-audit-badge"
      title={props.title ?? "An audit is available"}
    >
      <svg
        className="dsh-audit-badge__icon"
        viewBox="0 0 14 14"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="m3 7.5 2.5 2.5L11 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {props.label ?? "Audited"}
    </span>
  );
}

/** Everything the status bar renders, taken as plain values. */
export interface AuditStatusBarProps {
  /** `excellent` | `good` | `mixed` | `poor` | `failed` | `insufficient_evidence`. */
  readonly verdict: string;
  readonly outcomeStatus?: string;
  readonly evidenceLevel?: string;
  readonly findings: {
    readonly critical: number;
    readonly major: number;
    readonly minor: number;
    readonly observation: number;
    readonly other: number;
  };
  readonly model?: string;
  readonly agentPreset?: string;
  readonly toolCalls?: number;
  readonly toolErrors?: number;
  readonly modifiedAt?: string;
  /** Drops the metadata row, for a dialog that has its own header. */
  readonly compact?: boolean;
}

/** The headline: verdict, outcome, evidence level and the finding counts. */
export function AuditStatusBar(props: AuditStatusBarProps): ReactNode {
  const verdict = normalizeVerdict(props.verdict);
  const total = totalFindings(props.findings);
  return (
    <div
      className={
        props.compact === true
          ? "dsh-audit-status dsh-audit-status--compact"
          : "dsh-audit-status"
      }
    >
      <div className="dsh-audit-status__headline">
        <span
          className={`dsh-audit-status__verdict dsh-audit-status__verdict--${verdictTone(verdict)}`}
        >
          {verdictLabel(props.verdict)}
        </span>
        {props.outcomeStatus === undefined ||
        props.outcomeStatus.length === 0 ? null : (
          <span className="dsh-audit-status__chip">
            {outcomeLabel(props.outcomeStatus)}
          </span>
        )}
        {props.evidenceLevel === undefined ||
        props.evidenceLevel.length === 0 ? null : (
          <span className="dsh-audit-status__chip dsh-audit-status__chip--quiet">
            {evidenceLabel(props.evidenceLevel)}
          </span>
        )}
      </div>
      <p
        className={
          total === 0
            ? "dsh-audit-status__findings dsh-audit-status__findings--clean"
            : "dsh-audit-status__findings"
        }
      >
        {findingsLabel(props.findings)}
      </p>
      {props.compact === true ? null : (
        <dl className="dsh-audit-status__meta">
          <Meta label="Model" value={props.model} />
          <Meta label="Preset" value={props.agentPreset} />
          <Meta
            label="Tool calls"
            value={
              props.toolCalls === undefined
                ? undefined
                : formatCount(props.toolCalls)
            }
          />
          <Meta
            label="Tool errors"
            value={
              props.toolErrors === undefined
                ? undefined
                : formatCount(props.toolErrors)
            }
          />
          <Meta
            label="Updated"
            value={
              props.modifiedAt === undefined
                ? undefined
                : formatTimestamp(props.modifiedAt)
            }
          />
        </dl>
      )}
    </div>
  );
}

function Meta(props: {
  readonly label: string;
  readonly value: string | undefined;
}): ReactNode {
  if (props.value === undefined || props.value.length === 0) return null;
  return (
    <div className="dsh-audit-status__meta-pair">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

/** The scorecard: one row per dimension the producer scored. */
export function AuditScorecard(props: {
  readonly scores: AuditScorecard;
}): ReactNode {
  const dimensions = Object.keys(props.scores).sort();
  if (dimensions.length === 0) return null;
  return (
    <section className="dsh-audit-section">
      <h3 className="dsh-audit-section__title">Scorecard</h3>
      <ul className="dsh-audit-scores">
        {dimensions.map((dimension) => {
          const score = props.scores[dimension];
          if (score === undefined) return null;
          const numeric = typeof score.score === "number" ? score.score : null;
          return (
            <li key={dimension} className="dsh-audit-scores__row">
              <div className="dsh-audit-scores__head">
                <span className="dsh-audit-scores__name">{dimension}</span>
                <span
                  className={
                    numeric === null
                      ? "dsh-audit-scores__value dsh-audit-scores__value--na"
                      : `dsh-audit-scores__value dsh-audit-scores__value--${numeric}`
                  }
                >
                  {score.score === null ? "—" : String(score.score)}
                </span>
              </div>
              {score.summary.length === 0 ? null : (
                <p className="dsh-audit-scores__summary">{score.summary}</p>
              )}
              <div className="dsh-audit-scores__foot">
                <span className="dsh-audit-scores__confidence">
                  {normalizeConfidence(score.confidence)} confidence
                </span>
                {score.evidence.length === 0 ? null : (
                  <span className="dsh-audit-scores__evidence">
                    {score.evidence.join(" · ")}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One finding, as a card. */
export function AuditFindingCard(props: {
  readonly finding: AuditFinding;
}): ReactNode {
  const { finding } = props;
  const severity = normalizeSeverity(finding.severity);
  return (
    <article className={`dsh-audit-finding dsh-audit-finding--${severity}`}>
      <header className="dsh-audit-finding__head">
        <span className="dsh-audit-finding__id">{finding.id}</span>
        <span
          className={`dsh-audit-finding__severity dsh-audit-finding__severity--${severity}`}
        >
          {finding.severity.length === 0 ? "unclassified" : finding.severity}
        </span>
        {finding.category.length === 0 ? null : (
          <span className="dsh-audit-finding__category">
            {finding.category}
          </span>
        )}
        {finding.status.length === 0 ? null : (
          <span className="dsh-audit-finding__status">{finding.status}</span>
        )}
      </header>
      {finding.title.length === 0 ? null : (
        <h4 className="dsh-audit-finding__title">{finding.title}</h4>
      )}
      {finding.description.length === 0 ? null : (
        <p className="dsh-audit-finding__description">{finding.description}</p>
      )}
      <dl className="dsh-audit-finding__facts">
        {finding.rootCause.length === 0 ? null : (
          <div>
            <dt>Root cause</dt>
            <dd>{finding.rootCause}</dd>
          </div>
        )}
        {finding.recommendationTarget.length === 0 ? null : (
          <div>
            <dt>Target</dt>
            <dd>{finding.recommendationTarget}</dd>
          </div>
        )}
        {finding.evidence.length === 0 ? null : (
          <div>
            <dt>Evidence</dt>
            <dd>{finding.evidence.join(" · ")}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

/**
 * The findings list.
 *
 * Groups are ordered most-severe-first, and a severity this build does not
 * know lands in its own group under the producer's own word rather than being
 * dropped or silently reclassified.
 */
export function AuditFindings(props: {
  readonly findings: readonly AuditFinding[];
}): ReactNode {
  if (props.findings.length === 0) {
    return <p className="dsh-audit-empty">The auditor recorded no findings.</p>;
  }

  const groups = new Map<string, AuditFinding[]>();
  for (const finding of props.findings) {
    const key =
      normalizeSeverity(finding.severity) === "other"
        ? finding.severity.length === 0
          ? "unclassified"
          : finding.severity
        : normalizeSeverity(finding.severity);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [finding]);
    else bucket.push(finding);
  }

  const ordered = [...groups.entries()].sort(
    ([left], [right]) => severityRank(left) - severityRank(right),
  );

  return (
    <div className="dsh-audit-findings">
      {ordered.map(([group, findings]) => (
        <section key={group} className="dsh-audit-findings__group">
          <h3 className="dsh-audit-findings__group-title">
            {group}
            <span className="dsh-audit-findings__group-count">
              {findings.length}
            </span>
          </h3>
          {findings.map((finding, index) => (
            <AuditFindingCard
              key={`${finding.id}-${index}`}
              finding={finding}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/** The recommended changes. */
export function AuditRecommendations(props: {
  readonly recommendations: readonly AuditRecommendation[];
}): ReactNode {
  if (props.recommendations.length === 0) return null;
  return (
    <section className="dsh-audit-section">
      <h3 className="dsh-audit-section__title">Recommended changes</h3>
      <ul className="dsh-audit-recommendations">
        {props.recommendations.map((recommendation, index) => (
          <li
            key={`${recommendation.target}-${index}`}
            className="dsh-audit-recommendation"
          >
            <div className="dsh-audit-recommendation__head">
              <span
                className={`dsh-audit-recommendation__priority dsh-audit-recommendation__priority--${normalizePriority(recommendation.priority)}`}
              >
                {recommendation.priority.length === 0
                  ? "unprioritised"
                  : recommendation.priority}
              </span>
              {recommendation.target.length === 0 ? null : (
                <span className="dsh-audit-recommendation__target">
                  {recommendation.target}
                </span>
              )}
            </div>
            {recommendation.action.length === 0 ? null : (
              <p className="dsh-audit-recommendation__action">
                {recommendation.action}
              </p>
            )}
            {recommendation.evidence.length === 0 ? null : (
              <p className="dsh-audit-recommendation__evidence">
                {recommendation.evidence.join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The better trajectory, as an ordered list of steps. */
export function AuditBetterTrajectory(props: {
  readonly steps: readonly string[];
}): ReactNode {
  if (props.steps.length === 0) return null;
  return (
    <section className="dsh-audit-section">
      <h3 className="dsh-audit-section__title">Better trajectory</h3>
      <ol className="dsh-audit-steps">
        {props.steps.map((step, index) => (
          <li key={index} className="dsh-audit-steps__item">
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What the auditor could not establish. */
export function AuditLimitations(props: {
  readonly limitations: readonly string[];
}): ReactNode {
  if (props.limitations.length === 0) return null;
  return (
    <section className="dsh-audit-section dsh-audit-section--quiet">
      <h3 className="dsh-audit-section__title">Evidence limitations</h3>
      <ul className="dsh-audit-limitations">
        {props.limitations.map((limitation, index) => (
          <li key={index}>{limitation}</li>
        ))}
      </ul>
    </section>
  );
}

/** Capabilities the agent could have used and did not. */
export function AuditMissedOpportunities(props: {
  readonly opportunities: AuditAnalysisV1["missedOpportunities"];
}): ReactNode {
  if (props.opportunities.length === 0) return null;
  return (
    <section className="dsh-audit-section">
      <h3 className="dsh-audit-section__title">Missed opportunities</h3>
      <ul className="dsh-audit-opportunities">
        {props.opportunities.map((opportunity, index) => (
          <li key={index} className="dsh-audit-opportunity">
            <div className="dsh-audit-opportunity__head">
              <span className="dsh-audit-opportunity__capability">
                {opportunity.capability}
              </span>
              {opportunity.confidence.length === 0 ? null : (
                <span className="dsh-audit-opportunity__confidence">
                  {opportunity.confidence}
                </span>
              )}
            </div>
            {opportunity.why.length === 0 ? null : (
              <p className="dsh-audit-opportunity__why">{opportunity.why}</p>
            )}
            {opportunity.evidence.length === 0 ? null : (
              <p className="dsh-audit-opportunity__evidence">
                {opportunity.evidence.join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The report tab: `REPORT.md` rendered, with its table of contents. */
export function AuditReport(props: {
  readonly markdown: string;
  /** Renders the headings as a table of contents above the body. */
  readonly tableOfContents?: boolean;
}): ReactNode {
  const parsed = parseReport(props.markdown);
  if (parsed.blocks.length === 0) {
    return <p className="dsh-audit-empty">This audit has no report.</p>;
  }
  const showToc = props.tableOfContents !== false && parsed.headings.length > 2;
  return (
    <div className="dsh-audit-report">
      {showToc ? (
        <nav className="dsh-audit-report__toc" aria-label="Report contents">
          <ol>
            {parsed.headings.map((heading) => (
              <li key={heading.id} data-depth={heading.depth}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="dsh-audit-md">{renderReport(parsed)}</div>
    </div>
  );
}

/** Shown when a session has no audit. */
export function AuditEmptyState(props: {
  readonly title?: string;
  readonly hint?: string;
}): ReactNode {
  return (
    <div className="dsh-audit-state">
      <p className="dsh-audit-state__title">
        {props.title ?? "No audit available for this session"}
      </p>
      {props.hint === undefined ? null : (
        <p className="dsh-audit-state__hint">{props.hint}</p>
      )}
    </div>
  );
}

/** Shown when the audit could not be loaded. */
export function AuditErrorState(props: {
  readonly message?: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}): ReactNode {
  return (
    <div className="dsh-audit-state dsh-audit-state--error" role="alert">
      <p className="dsh-audit-state__title">
        {props.message ?? "The audit could not be loaded"}
      </p>
      {props.onRetry === undefined ? null : (
        <button
          type="button"
          className="dsh-audit-state__action"
          onClick={props.onRetry}
        >
          {props.retryLabel ?? "Try again"}
        </button>
      )}
    </div>
  );
}

/** The tab strip over the audit's views. */
export function AuditTabs<T extends string>(props: {
  readonly tabs: readonly { readonly id: T; readonly label: string }[];
  readonly active: T;
  readonly onSelect: (id: T) => void;
  readonly ariaLabel?: string;
}): ReactNode {
  return (
    <div
      className="dsh-audit-tabs"
      role="tablist"
      aria-label={props.ariaLabel ?? "Audit views"}
    >
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === props.active}
          className={
            tab.id === props.active
              ? "dsh-audit-tabs__tab dsh-audit-tabs__tab--active"
              : "dsh-audit-tabs__tab"
          }
          onClick={() => props.onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
