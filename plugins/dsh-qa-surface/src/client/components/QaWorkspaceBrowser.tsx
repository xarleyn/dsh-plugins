import { useCallback, useEffect, useRef, useState } from "react";
import type { QaWorkspaceEntry, QaWorkspaceFile } from "../../types.js";
import type { QaBoundSourceApi } from "../types.js";
import { formatFileSize } from "../attachments.js";
import { base64ToBytes } from "../base64.js";
import { sourcePreviewFailureCopy } from "../source-preview.js";
import { Markdown } from "./Markdown.js";

/** Name of one entry: the last path segment, root spelled as the directory. */
function entryName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** Path join for the panel's own navigation, never leaving the chat root. */
function joinPath(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

/** The breadcrumb of one directory: root label plus one crumb per segment. */
function crumbsOf(
  path: string,
): readonly { readonly label: string; readonly path: string }[] {
  const crumbs: { label: string; path: string }[] = [
    { label: "Рабочий каталог", path: "" },
  ];
  let current = "";
  for (const segment of path.split("/")) {
    if (segment === "") continue;
    current = joinPath(current, segment);
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

/** Hand one file to the browser's download machinery. */
function downloadFile(file: QaWorkspaceFile): void {
  const bytes =
    file.base64 === undefined
      ? new TextEncoder().encode(file.text ?? "")
      : base64ToBytes(file.base64);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: file.mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = entryName(file.path);
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** One row of the listing: a directory to descend into or a file to open. */
function EntryRow({
  entry,
  directory,
  onOpenFile,
  onOpenDirectory,
}: {
  readonly entry: QaWorkspaceEntry;
  readonly directory: string;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenDirectory: (path: string) => void;
}) {
  const path = joinPath(directory, entry.name);
  return (
    <li className="dsh-qa-ws__row">
      <button
        type="button"
        className="dsh-qa-ws__entry"
        data-kind={entry.type}
        onClick={() =>
          entry.type === "directory" ? onOpenDirectory(path) : onOpenFile(path)
        }
      >
        <span className="dsh-qa-ws__icon" aria-hidden="true">
          <svg viewBox="0 0 14 14">
            {entry.type === "directory" ? (
              <path d="M1.75 3.5h4l1 1.25h4.5v5.75h-9.5z" />
            ) : (
              <path d="M3.25 1.75h5l2.5 2.5v8h-7.5zM8.25 1.75v2.5h2.5" />
            )}
          </svg>
        </span>
        <span className="dsh-qa-ws__name">{entry.name}</span>
        {entry.size === null ? null : (
          <span className="dsh-qa-ws__size">{formatFileSize(entry.size)}</span>
        )}
      </button>
    </li>
  );
}

/** The opened file: markdown or plain text inline, anything else as a handle. */
function FilePreview({
  file,
  status,
  onBack,
}: {
  readonly file: QaWorkspaceFile | undefined;
  readonly status: "loading" | "ready" | "refused";
  readonly onBack: () => void;
}) {
  const [raw, setRaw] = useState(false);
  useEffect(() => setRaw(false), [file?.path]);
  if (status !== "ready" || file === undefined) {
    return (
      <div className="dsh-qa-ws__preview">
        <button type="button" className="dsh-qa-ws__back" onClick={onBack}>
          ← К файлам
        </button>
        <p className="dsh-qa-ws__status">
          {status === "loading" ? "Открываю файл…" : "Файл недоступен."}
        </p>
      </div>
    );
  }
  const image = file.mime.startsWith("image/") && file.base64 !== undefined;
  const rendered = file.markdown && file.renderableMarkdown && !raw;
  return (
    <div className="dsh-qa-ws__preview">
      <div className="dsh-qa-ws__preview-head">
        <button type="button" className="dsh-qa-ws__back" onClick={onBack}>
          ← К файлам
        </button>
        <span className="dsh-qa-ws__preview-name" title={file.path}>
          {entryName(file.path)}
        </span>
        <button
          type="button"
          className="dsh-qa-ws__download"
          onClick={() => downloadFile(file)}
        >
          Скачать
        </button>
      </div>
      <p className="dsh-qa-ws__meta">
        {formatFileSize(file.size)}
        {file.truncated ? " · показана только часть файла" : ""}
      </p>
      {file.markdown && file.renderableMarkdown ? (
        <button
          type="button"
          className="dsh-qa-ws__toggle"
          aria-pressed={raw}
          onClick={() => setRaw((value) => !value)}
        >
          {raw ? "Показать разметкой" : "Показать исходником"}
        </button>
      ) : null}
      {image ? (
        <img
          className="dsh-qa-ws__image"
          alt={entryName(file.path)}
          src={`data:${file.mime};base64,${file.base64 ?? ""}`}
        />
      ) : rendered ? (
        <Markdown text={file.text ?? ""} />
      ) : file.text === undefined ? (
        <p className="dsh-qa-ws__status">
          Файл не читается как текст — его можно скачать целиком.
        </p>
      ) : (
        <pre className="dsh-qa-ws__text">{file.text}</pre>
      )}
    </div>
  );
}

export interface QaWorkspaceBrowserProps {
  readonly sessionId: string;
  readonly api: QaBoundSourceApi;
}

/**
 * The chat's own workspace, browsable from the files rail.
 *
 * One directory at a time: the Host lists a directory, the panel descends into
 * its children and never travels by path, so a link in a listing cannot walk
 * the visitor out of the chat's tree. Opening a file reads exactly that file —
 * text inline, anything else as a downloadable handle.
 */
export function QaWorkspaceBrowser({
  sessionId,
  api,
}: QaWorkspaceBrowserProps) {
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<readonly QaWorkspaceEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "refused">(
    "loading",
  );
  const [listFailure, setListFailure] = useState("");
  const [file, setFile] = useState<QaWorkspaceFile | undefined>(undefined);
  const [fileStatus, setFileStatus] = useState<"loading" | "ready" | "refused">(
    "loading",
  );
  const [opened, setOpened] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = generation.current + 1;
    generation.current = current;
    setListStatus("loading");
    api.listWorkspaceFiles(sessionId, directory).then(
      (result) => {
        if (generation.current !== current) return;
        if (!result.ok) {
          setListFailure(sourcePreviewFailureCopy(result.error));
          setListStatus("refused");
          return;
        }
        setEntries(result.value.entries);
        setTruncated(result.value.truncated);
        setListStatus("ready");
      },
      (failure: unknown) => {
        if (generation.current !== current) return;
        setListFailure(sourcePreviewFailureCopy(failure));
        setListStatus("refused");
      },
    );
  }, [api, directory, sessionId]);

  const openFile = useCallback(
    (path: string) => {
      setOpened(path);
      setFile(undefined);
      setFileStatus("loading");
      api.readWorkspaceFile(sessionId, path).then(
        (result) => {
          setOpened((current) => {
            if (current !== path) return current;
            if (result.ok) {
              setFile(result.value);
              setFileStatus("ready");
            } else {
              setFileStatus("refused");
            }
            return current;
          });
        },
        () => {
          setOpened((current) => {
            if (current === path) setFileStatus("refused");
            return current;
          });
        },
      );
    },
    [api, sessionId],
  );

  if (opened !== null) {
    return (
      <FilePreview
        file={file}
        status={fileStatus}
        onBack={() => {
          setOpened(null);
          setFile(undefined);
        }}
      />
    );
  }
  const crumbs = crumbsOf(directory);
  return (
    <div className="dsh-qa-ws">
      <nav className="dsh-qa-ws__crumbs" aria-label="Путь в рабочем каталоге">
        {crumbs.map((crumb, index) => (
          <span key={crumb.path}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <button
              type="button"
              className="dsh-qa-ws__crumb"
              aria-current={index === crumbs.length - 1 ? "true" : undefined}
              onClick={() => setDirectory(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>
      {listStatus === "loading" ? (
        <p className="dsh-qa-ws__status">Читаю каталог…</p>
      ) : listStatus === "refused" ? (
        <p className="dsh-qa-ws__status">{listFailure}</p>
      ) : entries.length === 0 ? (
        <p className="dsh-qa-ws__status">Каталог пуст.</p>
      ) : (
        <ul className="dsh-qa-ws__list">
          {entries.map((entry) => (
            <EntryRow
              key={`${entry.type}:${entry.name}`}
              entry={entry}
              directory={directory}
              onOpenFile={openFile}
              onOpenDirectory={setDirectory}
            />
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="dsh-qa-ws__status">Показаны не все файлы каталога.</p>
      ) : null}
    </div>
  );
}
