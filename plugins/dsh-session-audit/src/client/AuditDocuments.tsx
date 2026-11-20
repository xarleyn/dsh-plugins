import { memo, type ReactNode } from "react";
import { AuditReport } from "@yadsh/dsh-audit-ui";

const MAX_MARKDOWN_CHARACTERS = 48 * 1024;
const MAX_PREVIEW_CHARACTERS = 4_000;

export function AuditDownload(props: {
  readonly text: string;
  readonly filename: string;
  readonly label: string;
}): ReactNode {
  function download() {
    const href = URL.createObjectURL(
      new Blob([props.text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = href;
    link.download = props.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
  }
  return (
    <button type="button" onClick={download}>
      {props.label}
    </button>
  );
}

export const AuditReportPane = memo(function AuditReportPane(props: {
  readonly report: string;
}): ReactNode {
  if (props.report.length <= MAX_MARKDOWN_CHARACTERS)
    return <AuditReport markdown={props.report} />;
  return (
    <section className="dsh-audit-comparison">
      <p>
        This report is too large to render inline. The preview shows its first
        4,000 characters.
      </p>
      <AuditDownload
        text={props.report}
        filename="REPORT.md"
        label="Download full report"
      />
      <pre>{props.report.slice(0, MAX_PREVIEW_CHARACTERS)}</pre>
    </section>
  );
});
