import type { KnownAuditAnalysis } from "@yadsh/dsh-audit-core";
import type { ReactNode } from "react";

const ENGLISH = {
  title: "Audit provenance",
  producer: "Report producer",
  producerVersion: "Producer version",
  auditorType: "Auditor type",
  auditorModel: "Auditor model",
  sessionModel: "Session model",
};

export interface AuditProvenanceProps {
  readonly analysis: KnownAuditAnalysis | null;
  /** Summary fallback when the viewer only has the bounded document header. */
  readonly sessionModel?: string;
  readonly labels?: Readonly<typeof ENGLISH>;
}

const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]*$/u;
const IDENTIFIER =
  /^@?[\p{L}\p{N}][\p{L}\p{N}._+-]*(?:\/[\p{L}\p{N}][\p{L}\p{N}._+-]*){0,2}(?::[\p{L}\p{N}][\p{L}\p{N}._+-]*)?$/u;
const FILE_SUFFIX =
  /\.(?:gguf|safetensors|onnx|json|ya?ml|toml|log|pem|key|env)$/iu;
const CREDENTIAL_PREFIX =
  /^(?:bearer\s|basic\s|sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|AKIA[\dA-Z]{16}$|eyJ[\w-]+\.[\w-]+\.)/iu;

/** Accept short labels or IDs, including a scoped producer or provider/model. */
function displayValue(input: string | undefined): string | undefined {
  const value = input?.trim();
  if (
    value === undefined ||
    value.length > 120 ||
    FILE_SUFFIX.test(value) ||
    CREDENTIAL_PREFIX.test(value) ||
    (!LABEL.test(value) && !IDENTIFIER.test(value))
  )
    return undefined;
  return value;
}

/** Only the explicit provenance fields from an understood analysis reach this view. */
export function AuditProvenance({
  analysis,
  sessionModel,
  labels = ENGLISH,
}: AuditProvenanceProps): ReactNode {
  const rows = [
    [labels.producer, displayValue(analysis?.audit?.producer.name)],
    [labels.producerVersion, displayValue(analysis?.audit?.producer.version)],
    [labels.auditorType, displayValue(analysis?.auditor?.type)],
    [labels.auditorModel, displayValue(analysis?.auditor?.model)],
    [
      labels.sessionModel,
      displayValue(analysis?.trajectory.model || sessionModel),
    ],
  ] as const;
  if (rows.every(([, value]) => value === undefined)) return null;
  return (
    <dl
      className="dsh-audit-provenance"
      aria-label={labels.title}
      data-testid="audit-provenance"
    >
      {rows.map(([label, value]) =>
        value === undefined ? null : (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ),
      )}
    </dl>
  );
}
