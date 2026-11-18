import { useId, useState } from "react";
import {
  MAX_CATALOG_BYTES,
  type CatalogApplyResult,
  type CatalogChange,
  type CatalogExportResult,
  type CatalogImportMode,
  type CatalogPreview,
  type CatalogPreviewResult,
} from "../types.js";
import { StatusLine } from "./components.js";
import type { ApiOutcome } from "./remote.js";

export interface CatalogTransferApi {
  exportCatalog(): Promise<ApiOutcome<CatalogExportResult>>;
  previewCatalogImport(
    document: string,
    mode: CatalogImportMode,
  ): Promise<ApiOutcome<CatalogPreviewResult>>;
  applyCatalogImport(
    document: string,
    mode: CatalogImportMode,
    token: string,
  ): Promise<ApiOutcome<CatalogApplyResult>>;
}

const ACTION_LABELS: Record<CatalogChange["action"], string> = {
  add: "Add",
  keep: "Conflict — keep installed definition",
  update: "Conflict — update definition",
  remove: "Remove definition",
  unchanged: "Unchanged",
};

function downloadCatalog(documentText: string): void {
  const url = URL.createObjectURL(
    new Blob([documentText], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "domain-catalog.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function CatalogTransfer({
  api,
  onApplied,
}: {
  readonly api: CatalogTransferApi;
  readonly onApplied: () => Promise<void>;
}) {
  const modeId = useId();
  const [source, setSource] = useState<string | null>(null);
  const [mode, setMode] = useState<CatalogImportMode>("merge");
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);
  const hasWrites =
    preview?.changes.some(
      ({ action }) =>
        action === "add" || action === "update" || action === "remove",
    ) ?? false;

  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch {
      setStatus({
        tone: "error",
        text: "The catalog operation could not finish.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function selectFile(file: File): Promise<void> {
    setSource(null);
    setPreview(null);
    if (file.size > MAX_CATALOG_BYTES) {
      setStatus({
        tone: "error",
        text: "Choose a JSON file of at most 512 KiB.",
      });
      return;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      setSource(text);
    } catch {
      setStatus({
        tone: "error",
        text: "The JSON file must be readable UTF-8.",
      });
    }
  }

  async function exportFile(): Promise<void> {
    const outcome = await api.exportCatalog();
    if (!outcome.ok) {
      setStatus({ tone: "error", text: outcome.message });
      return;
    }
    downloadCatalog(outcome.data.document);
  }

  async function previewFile(): Promise<void> {
    if (source === null) return;
    setPreview(null);
    const outcome = await api.previewCatalogImport(source, mode);
    if (!outcome.ok) {
      setStatus({ tone: "error", text: outcome.message });
      return;
    }
    setPreview(outcome.data.preview);
  }

  async function applyFile(): Promise<void> {
    if (source === null || preview === null) return;
    const outcome = await api.applyCatalogImport(source, mode, preview.token);
    setPreview(null);
    if (!outcome.ok) {
      setStatus({ tone: "error", text: outcome.message });
      return;
    }
    setStatus({
      tone: "info",
      text: `${outcome.data.changed} catalog ${outcome.data.changed === 1 ? "definition" : "definitions"} changed.`,
    });
    await onApplied();
  }

  return (
    <details className="dx-transfer" data-testid="domain-experts-transfer">
      <summary>Import or export catalog</summary>
      <div className="dx-transfer-body">
        <div className="dx-actions">
          <button
            type="button"
            className="dx-button"
            disabled={busy}
            onClick={() => {
              void perform(exportFile);
            }}
          >
            Export JSON
          </button>
          <label className="dx-field">
            JSON file
            <input
              className="dx-input"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file !== undefined) void perform(() => selectFile(file));
              }}
            />
          </label>
          <div className="dx-field">
            <label htmlFor={modeId}>Import mode</label>
            <select
              id={modeId}
              className="dx-select"
              value={mode}
              disabled={busy}
              onChange={(event) => {
                setMode(event.target.value === "replace" ? "replace" : "merge");
                setPreview(null);
                setStatus(null);
              }}
            >
              <option value="merge">Merge · keep installed definitions</option>
              <option value="replace">
                Replace · use the file as the catalog
              </option>
            </select>
          </div>
          <button
            type="button"
            className="dx-button"
            disabled={busy || source === null}
            onClick={() => {
              void perform(previewFile);
            }}
          >
            Preview import
          </button>
        </div>
        {preview === null ? null : (
          <div className="dx-transfer-body">
            {hasWrites ? null : (
              <p className="dx-status">No catalog changes to apply.</p>
            )}
            <ul
              className="dx-transfer-preview"
              aria-label="Catalog changes"
              data-testid="domain-experts-transfer-preview"
            >
              {preview.changes.map(({ id, action }) => (
                <li key={id}>
                  <code>{id}</code>
                  <span>{ACTION_LABELS[action]}</span>
                </li>
              ))}
            </ul>
            {hasWrites ? (
              <div>
                <button
                  type="button"
                  className="dx-button dx-button--primary"
                  disabled={busy}
                  onClick={() => {
                    void perform(applyFile);
                  }}
                >
                  {mode === "replace" ? "Replace catalog" : "Apply merge"}
                </button>
              </div>
            ) : null}
          </div>
        )}
        {status === null ? null : (
          <StatusLine
            tone={status.tone}
            testId="domain-experts-transfer-status"
          >
            {status.text}
          </StatusLine>
        )}
      </div>
    </details>
  );
}
