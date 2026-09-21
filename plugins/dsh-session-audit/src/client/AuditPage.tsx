/**
 * The Audit view for one session: the full conversation page.
 *
 * The shell is this plugin's own — a status bar, a tab strip, an optional
 * at-a-glance column — and every piece of the audit it shows comes from
 * `@yadsh/dsh-audit-ui`, the same components the QA Surface's dialog renders
 * (SPEC §51). Nothing below this file knows it is inside a session page.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  AuditFindings,
  AuditBetterTrajectory,
  AuditEmptyState,
  AuditErrorState,
  AuditJsonTree,
  AuditLimitations,
  AuditMissedOpportunities,
  AuditRecommendations,
  AuditReport,
  AuditScorecard,
  AuditStatusBar,
  AuditTabs,
} from "@yadsh/dsh-audit-ui";
import { UnattachedAudits } from "./UnattachedAudits.js";
import type { AuditApi } from "./api.js";
import { knownAnalysis } from "./analysis.js";
import {
  useAuditDetail,
  useAuditSummary,
  useUnattachedAudits,
} from "./use-session-audit.js";

/** The three views of one audit (SPEC §38). */
type AuditTab = "report" | "findings" | "json";

const TABS: readonly { readonly id: AuditTab; readonly label: string }[] = [
  { id: "report", label: "Report" },
  { id: "findings", label: "Findings" },
  { id: "json", label: "JSON" },
];

export interface AuditPageProps {
  readonly sessionId: string;
  readonly api: AuditApi;
}

export function AuditPage(props: AuditPageProps): ReactNode {
  const { api, sessionId } = props;
  const [tab, setTab] = useState<AuditTab>("report");
  const summary = useAuditSummary(api, sessionId);
  const unattached = useUnattachedAudits(api);
  const modifiedAt = summary.summary?.modifiedAt ?? null;

  // The documents are fetched only once there is an audit to fetch, which is
  // what keeps a session with no audit as cheap as a session list row.
  const detail = useAuditDetail(
    api,
    sessionId,
    modifiedAt,
    summary.status === "ready",
  );

  const analysis = useMemo(
    () => (detail.parsed === null ? null : knownAnalysis(detail.parsed)),
    [detail.parsed],
  );

  if (summary.status === "loading") {
    return <AuditEmptyState title="Loading the audit…" />;
  }
  if (summary.status === "error") {
    return (
      <AuditErrorState
        message={summary.error ?? "The audit could not be loaded"}
      />
    );
  }
  if (summary.status === "empty" || summary.summary === null) {
    // The notice goes above the empty state, not below it: a reader who sees
    // "no audit for this session" is exactly the reader who needs to hear that
    // audits exist elsewhere in the root.
    return (
      <div className="dsh-audit-page dsh-audit-page--empty">
        <UnattachedAudits items={unattached} />
        <div className="dsh-audit-page__state">
          <AuditEmptyState hint="An audit appears here after an auditor writes its analysis and report into the audit root." />
        </div>
      </div>
    );
  }

  const value = summary.summary;

  return (
    <div className="dsh-audit-page">
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
        {...(value.model.length === 0 ? {} : { model: value.model })}
        {...(value.agentPreset.length === 0
          ? {}
          : { agentPreset: value.agentPreset })}
        {...(value.toolCalls < 0 ? {} : { toolCalls: value.toolCalls })}
        {...(value.toolErrors < 0 ? {} : { toolErrors: value.toolErrors })}
        {...(value.modifiedAt.length === 0
          ? {}
          : { modifiedAt: value.modifiedAt })}
      />

      <UnattachedAudits items={unattached} />

      <AuditTabs
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        ariaLabel="Audit views"
      />

      <div className="dsh-audit-page__body">
        <aside className="dsh-audit-page__side" aria-label="Audit at a glance">
          <AuditSidebar
            analysis={analysis}
            schemaVersion={value.schemaVersion}
          />
        </aside>

        <div className="dsh-audit-page__main" role="tabpanel">
          {detail.status === "error" ? (
            <AuditErrorState
              message={detail.error ?? "The audit could not be loaded"}
              onRetry={detail.reload}
            />
          ) : detail.status !== "ready" || detail.value === null ? (
            <AuditEmptyState title="Loading the audit…" />
          ) : tab === "report" ? (
            <AuditReport markdown={detail.value.report} />
          ) : tab === "findings" ? (
            <FindingsPane analysis={analysis} />
          ) : (
            // Parsed here rather than in the hook: the tree is only built when
            // a reader asks for it (SPEC §33).
            <JsonPane raw={detail.parsed?.raw ?? null} />
          )}
        </div>
      </div>
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
      <AuditFindings findings={analysis.findings} />
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
}): ReactNode {
  const { analysis } = props;
  const scores = analysis?.scores ?? {};
  const hasScores = Object.keys(scores).length > 0;

  return (
    <div className="dsh-audit-side">
      {hasScores ? <AuditScorecard scores={scores} /> : null}
      {analysis === null ? (
        <p className="dsh-audit-side__note">
          Structured details are unavailable for schema version{" "}
          {props.schemaVersion < 0 ? "unknown" : props.schemaVersion}. The
          report and the raw JSON remain readable.
        </p>
      ) : null}
    </div>
  );
}
