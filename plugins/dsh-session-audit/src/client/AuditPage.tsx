/**
 * The Audit view for one session: the full conversation page.
 *
 * The shell is this plugin's own — a status bar, a tab strip, an optional
 * at-a-glance column — and every piece of the audit it shows comes from
 * `@yadsh/dsh-audit-ui`, the same components the QA Surface's dialog renders
 * (SPEC §51). Nothing below this file knows it is inside a session page.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  AuditFindings,
  AuditBetterTrajectory,
  AuditEmptyState,
  AuditErrorState,
  AuditJsonTree,
  AuditLimitations,
  AuditMissedOpportunities,
  AuditProvenance,
  AuditRecommendations,
  AuditScorecard,
  AuditStatusBar,
  AuditTabs,
} from "@yadsh/dsh-audit-ui";
import { UnattachedAudits } from "./UnattachedAudits.js";
import { AuditPicker } from "./AuditPicker.js";
import { AuditComparison } from "./AuditComparison.js";
import { AuditDownload, AuditReportPane } from "./AuditDocuments.js";
import type { AuditApi } from "./api.js";
import { knownAnalysis } from "./analysis.js";
import {
  useAuditDetail,
  useAuditHistory,
  useUnattachedAudits,
} from "./use-session-audit.js";

/** Document views plus comparison against another audit of the session. */
type AuditTab = "report" | "findings" | "json" | "compare";

const TABS: readonly { readonly id: AuditTab; readonly label: string }[] = [
  { id: "report", label: "Report" },
  { id: "findings", label: "Findings" },
  { id: "json", label: "JSON" },
  { id: "compare", label: "Compare" },
];

export interface AuditPageProps {
  readonly sessionId: string;
  readonly api: AuditApi;
}

export function AuditPage(props: AuditPageProps): ReactNode {
  return <SessionAuditPage key={props.sessionId} {...props} />;
}

function SessionAuditPage(props: AuditPageProps): ReactNode {
  const { api, sessionId } = props;
  const [tab, setTab] = useState<AuditTab>("report");
  const [selectedId, setSelectedId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const history = useAuditHistory(api, sessionId);
  const unattached = useUnattachedAudits(api);
  const entries = history.entries ?? [];
  const pinned = entries.find((entry) => entry.auditId === selectedId);
  const selected = pinned ?? entries[0];
  const baseline = entries.find(
    (entry) =>
      entry.auditId === baselineId && entry.auditId !== selected?.auditId,
  );
  const detail = useAuditDetail(api, sessionId, selected);
  const comparison = useAuditDetail(
    api,
    sessionId,
    tab === "compare" ? baseline : undefined,
  );
  const analysis =
    detail.status === "ready" && detail.parsed !== null
      ? knownAnalysis(detail.parsed)
      : null;

  useEffect(() => {
    if (history.entries === null) return;
    if (pinned === undefined) setSelectedId("");
    if (baseline === undefined) setBaselineId("");
  }, [history.entries, pinned, baseline]);

  if (history.entries === null) {
    return history.error === null ? (
      <AuditEmptyState title="Loading the audit…" />
    ) : (
      <AuditErrorState message={history.error} onRetry={history.reload} />
    );
  }
  if (selected === undefined) {
    // The notice goes above the empty state, not below it: a reader who sees
    // "no audit for this session" is exactly the reader who needs to hear that
    // audits exist elsewhere in the root.
    return (
      /*
       * The root keeps `audit-page`: the id names the container, not the branch,
       * so a test reaches the page the same way whether or not it has an audit,
       * exactly as `log-panel` stays put while `log-panel-empty` names its note.
       * The two branches are the same element, so only one of them is ever
       * mounted and the id stays unique in the document.
       */
      <div
        className="dsh-audit-page dsh-audit-page--empty"
        data-testid="audit-page"
      >
        <UnattachedAudits items={unattached} />
        <div className="dsh-audit-page__state" data-testid="audit-page-empty">
          <AuditEmptyState hint="An audit appears here after an auditor writes its analysis and report into the audit root." />
        </div>
      </div>
    );
  }

  const value = selected;

  return (
    <div className="dsh-audit-page" data-testid="audit-page">
      <AuditStatusBar
        verdict={value.verdict}
        {...(value.outcomeStatus.length === 0
          ? {}
          : { outcomeStatus: value.outcomeStatus })}
        {...(value.evidenceLevel.length === 0
          ? {}
          : { evidenceLevel: value.evidenceLevel })}
        findings={{
          critical: value.critical,
          major: value.major,
          minor: value.minor,
          observation: value.observation,
          other: value.other,
        }}
        {...(value.agentPreset.length === 0
          ? {}
          : { agentPreset: value.agentPreset })}
        {...(value.toolCalls < 0 ? {} : { toolCalls: value.toolCalls })}
        {...(value.toolErrors < 0 ? {} : { toolErrors: value.toolErrors })}
        {...(value.modifiedAt.length === 0
          ? {}
          : { modifiedAt: value.modifiedAt })}
      />

      <AuditProvenance analysis={analysis} sessionModel={value.model} />
      <UnattachedAudits items={unattached} />

      <div className="dsh-audit-history">
        {entries.length > 1 ? (
          <AuditPicker
            label="Audit version"
            emptyLabel="Current audit (latest)"
            entries={entries}
            selected={pinned?.auditId ?? ""}
            onSelect={setSelectedId}
          />
        ) : null}
        <button type="button" onClick={history.reload}>
          Refresh audits
        </button>
        {history.error === null ? null : (
          <span role="status">Audit history could not be refreshed.</span>
        )}
      </div>

      <AuditTabs
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        ariaLabel="Audit views"
      />

      <div className="dsh-audit-page__body">
        {tab !== "compare" && detail.status === "ready" ? (
          <AuditSidebar
            analysis={analysis}
            schemaVersion={value.schemaVersion}
            large={detail.parsed === null}
          />
        ) : null}

        <div
          className="dsh-audit-page__main"
          role="tabpanel"
          data-testid="audit-tabpanel"
        >
          {detail.status === "error" ? (
            <AuditErrorState
              message={detail.error ?? "The audit could not be loaded"}
              onRetry={detail.reload}
            />
          ) : detail.status === "empty" ? (
            <AuditErrorState
              message="This audit changed or is unavailable."
              onRetry={() => {
                history.reload();
                detail.reload();
              }}
            />
          ) : detail.status !== "ready" ? (
            <AuditEmptyState title="Loading the audit…" />
          ) : tab === "report" ? (
            <AuditReportPane report={detail.value.report} />
          ) : tab === "findings" ? (
            detail.parsed === null ? (
              <LargeAnalysis text={detail.value.analysisJson} />
            ) : (
              <FindingsPane analysis={analysis} />
            )
          ) : tab === "compare" ? (
            <div className="dsh-audit-comparison">
              {entries.length === 1 ? (
                <p>A second audit is needed for comparison.</p>
              ) : (
                <AuditPicker
                  label="Baseline audit"
                  emptyLabel="Select a baseline"
                  entries={entries.filter(
                    (entry) => entry.auditId !== value.auditId,
                  )}
                  selected={baseline?.auditId ?? ""}
                  onSelect={setBaselineId}
                />
              )}
              {baseline === undefined ? null : comparison.status === "error" ? (
                <AuditErrorState
                  message={comparison.error}
                  onRetry={comparison.reload}
                />
              ) : comparison.status === "empty" ? (
                <AuditErrorState
                  message="The baseline changed or is unavailable."
                  onRetry={() => {
                    history.reload();
                    comparison.reload();
                  }}
                />
              ) : comparison.status !== "ready" ? (
                <p>Loading the baseline…</p>
              ) : (
                <AuditComparison
                  baseline={
                    comparison.parsed === null
                      ? null
                      : knownAnalysis(comparison.parsed)
                  }
                  selected={analysis}
                  baselineReport={comparison.value.report}
                  selectedReport={detail.value.report}
                />
              )}
            </div>
          ) : detail.parsed === null ? (
            <LargeAnalysis text={detail.value.analysisJson} />
          ) : (
            <JsonPane raw={detail.parsed.raw} />
          )}
        </div>
      </div>
    </div>
  );
}

function LargeAnalysis({ text }: { readonly text: string }): ReactNode {
  return (
    <div className="dsh-audit-comparison">
      <p>This analysis is too large to display inline.</p>
      <AuditDownload
        text={text}
        filename="analysis.json"
        label="Download full analysis"
      />
    </div>
  );
}

/**
 * Everything the analysis states in structured form.
 *
 * The findings are the point of the tab, but recommendations and missed
 * opportunities live here too: they are the same structured document, and a
 * reader who wants "what should change" should not have to switch to the
 * report's prose to find it.
 */
function FindingsPane(props: {
  readonly analysis: ReturnType<typeof knownAnalysis>;
}): ReactNode {
  const { analysis } = props;
  if (analysis === null) {
    return (
      <AuditEmptyState
        title="This audit's findings cannot be shown"
        hint="Its schema version is newer than this build. The report and the raw JSON are still available."
      />
    );
  }
  return (
    <div className="dsh-audit-pane">
      <AuditFindings findings={analysis.findings.slice(0, 100)} />
      {analysis.findings.length > 100 ? (
        <p>
          Showing 100 of {analysis.findings.length} findings. The full analysis
          is available in JSON.
        </p>
      ) : null}
      <AuditMissedOpportunities opportunities={analysis.missedOpportunities} />
      <AuditRecommendations recommendations={analysis.recommendations} />
      <AuditBetterTrajectory steps={analysis.betterTrajectory} />
      <AuditLimitations limitations={analysis.limitations} />
    </div>
  );
}

function JsonPane(props: { readonly raw: unknown }): ReactNode {
  if (props.raw === null) {
    return (
      <AuditEmptyState
        title="This audit's analysis cannot be shown"
        hint="The document could not be decoded."
      />
    );
  }
  return (
    <div className="dsh-audit-pane dsh-audit-pane--json">
      <AuditJsonTree value={props.raw} />
    </div>
  );
}

/** The at-a-glance column: the structured facts, beside whichever tab is open. */
function AuditSidebar(props: {
  readonly analysis: ReturnType<typeof knownAnalysis>;
  readonly schemaVersion: number;
  readonly large: boolean;
}): ReactNode {
  const { analysis } = props;
  const scores = analysis?.scores ?? {};
  const hasScores = Object.keys(scores).length > 0;
  if (!hasScores && analysis !== null) return null;

  return (
    <aside className="dsh-audit-page__side" aria-label="Audit at a glance">
      {hasScores ? <AuditScorecard scores={scores} /> : null}
      {props.large ? (
        <p className="dsh-audit-side__note">
          The analysis exceeds the inline display limit.
        </p>
      ) : analysis === null ? (
        <p className="dsh-audit-side__note">
          Structured details are unavailable for schema version{" "}
          {props.schemaVersion < 0 ? "unknown" : props.schemaVersion}. The
          report and the raw JSON remain readable.
        </p>
      ) : null}
    </aside>
  );
}
