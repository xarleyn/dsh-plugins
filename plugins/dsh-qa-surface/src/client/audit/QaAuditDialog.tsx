/**
 * The audit dialog: the same content as the session page, in this surface's
 * own shell (SPEC §51).
 *
 * The status bar is compact and the tab strip is shared, because the audit is
 * the same audit — a reader who has seen it in the ordinary DSH session should
 * recognise every number here.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  AuditBetterTrajectory,
  AuditErrorState,
  AuditEmptyState,
  AuditFindings,
  AuditJsonTree,
  AuditLimitations,
  AuditMissedOpportunities,
  AuditRecommendations,
  AuditReport,
  AuditStatusBar,
  AuditTabs,
} from "@yadsh/dsh-audit-ui";
import { isKnownAnalysis, parseAuditAnalysis } from "@yadsh/dsh-audit-core";
import { QaModal } from "../components/QaModal.js";
import type { QaAuditApi, QaAuditSummary } from "./types.js";
import { useSessionAuditDocument } from "./use-chat-audits.js";

type AuditTab = "report" | "findings" | "json";

const TABS: readonly { readonly id: AuditTab; readonly label: string }[] = [
  { id: "report", label: "Отчёт" },
  { id: "findings", label: "Замечания" },
  { id: "json", label: "JSON" },
];

export interface QaAuditDialogProps {
  readonly open: boolean;
  readonly sessionId: string | null;
  readonly title: string;
  readonly api: QaAuditApi | null;
  /** The summary the badge was built from, for the reload key. */
  readonly summary: QaAuditSummary | undefined;
  readonly onClose: () => void;
}

export function QaAuditDialog(props: QaAuditDialogProps): ReactNode {
  const [tab, setTab] = useState<AuditTab>("report");
  const load = useSessionAuditDocument(
    props.api,
    props.sessionId,
    props.open && props.api !== null,
    props.summary?.modifiedAt ?? null,
  );

  const parsed = useMemo(
    () =>
      load.audit === null ? null : parseAuditAnalysis(load.audit.analysisJson),
    [load.audit],
  );
  const analysis =
    parsed !== null && parsed.ok && isKnownAnalysis(parsed.analysis)
      ? parsed.analysis
      : null;

  return (
    <QaModal
      open={props.open}
      title={props.title}
      closeLabel="Закрыть"
      size="wide"
      onClose={props.onClose}
    >
      <div className="dsh-qa-audit-dialog">
        {props.summary === undefined ? null : (
          <AuditStatusBar
            compact
            verdict={props.summary.verdict}
            {...(props.summary.outcomeStatus.length === 0
              ? {}
              : { outcomeStatus: props.summary.outcomeStatus })}
            {...(props.summary.evidenceLevel.length === 0
              ? {}
              : { evidenceLevel: props.summary.evidenceLevel })}
            findings={{
              critical: props.summary.critical,
              major: props.summary.major,
              minor: props.summary.minor,
              observation: props.summary.observation,
              other: props.summary.other,
            }}
          />
        )}

        <AuditTabs
          tabs={TABS}
          active={tab}
          onSelect={setTab}
          ariaLabel="Аудит"
        />

        <div className="dsh-qa-audit-dialog__body">{renderBody()}</div>
      </div>
    </QaModal>
  );

  function renderBody(): ReactNode {
    if (props.api === null) {
      return (
        <AuditEmptyState
          title="Модуль аудита не установлен"
          hint="Установите @yadsh/dsh-session-audit, чтобы смотреть аудиты в интерфейсе QA."
        />
      );
    }
    if (load.loading) return <AuditEmptyState title="Загрузка аудита…" />;
    if (load.error !== null) {
      return <AuditErrorState message={load.error} />;
    }
    if (load.audit === null) {
      return <AuditEmptyState />;
    }
    if (tab === "report") {
      return <AuditReport markdown={load.audit.report} />;
    }
    if (tab === "findings") {
      if (analysis === null) {
        return (
          <AuditEmptyState
            title="Структурированные замечания недоступны"
            hint="Версия схемы этого аудита новее, чем понимает установленный модуль. Отчёт и JSON остаются доступными."
          />
        );
      }
      return (
        <>
          <AuditFindings findings={analysis.findings} />
          <AuditMissedOpportunities
            opportunities={analysis.missedOpportunities}
          />
          <AuditRecommendations recommendations={analysis.recommendations} />
          <AuditBetterTrajectory steps={analysis.betterTrajectory} />
          <AuditLimitations limitations={analysis.limitations} />
        </>
      );
    }
    // The JSON view is built from the document as published, so a schema this
    // build does not know is still fully inspectable. Undecodable text is
    // handed over as the string it is rather than shown as nothing.
    const raw = decodeOrText(load.audit.analysisJson);
    return <AuditJsonTree value={raw} />;
  }
}

function decodeOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
