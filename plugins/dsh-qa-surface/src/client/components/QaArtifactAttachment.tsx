import type { QaArtifactView } from "../../types.js";
import { QaFileAttachment } from "./QaFileAttachment.js";

export function QaArtifactAttachment({
  artifact,
  onOpen,
  onDownload,
  onApprove,
}: {
  readonly artifact: QaArtifactView;
  readonly onOpen?: (file: QaArtifactView) => void;
  readonly onDownload?: (file: QaArtifactView) => void;
  readonly onApprove?: (file: QaArtifactView) => Promise<void>;
}) {
  const card = (file: QaArtifactView) => (
    <QaFileAttachment
      key={file.path}
      name={file.name}
      bytes={file.bytes}
      tone="sent"
      onOpen={onOpen && (() => onOpen(file))}
      onDownload={onDownload && (() => onDownload(file))}
      onApprove={
        onApprove && file.workflow?.status === "reviewed"
          ? () => onApprove(file)
          : undefined
      }
    />
  );
  const earlier = artifact.earlierEdits;
  if (!earlier?.length) return card(artifact);
  return (
    <div>
      {card(artifact)}
      <details>
        <summary>Предыдущие варианты ({earlier.length})</summary>
        <ol reversed>
          {earlier.map((file) => (
            <li key={file.path}>{card(file)}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
