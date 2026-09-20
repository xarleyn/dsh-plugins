import { useCallback, useEffect, useRef, useState } from "react";
import type {
  QaDocumentPreview,
  QaWorkspaceEntry,
  QaWorkspaceFile,
} from "../../types.js";
import type { QaBoundSourceApi } from "../types.js";
import { formatFileSize } from "../attachments.js";
import { base64ToBytes } from "../base64.js";
import { isConvertibleDocument } from "../../shared/documents.js";
import { sourcePreviewFailureCopy } from "../source-preview.js";
import { Markdown } from "./Markdown.js";
import { QaModal } from "./QaModal.js";

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

/**
 * Object URL for a PDF body, revoked when the payload changes or the panel
 * closes. A blob URL is what lets the browser's own viewer draw the document
 * without the bytes ever leaving the page.
 */
function usePdfUrl(payload: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (payload === undefined) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([base64ToBytes(payload) as BlobPart], {
        type: "application/pdf",
      }),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [payload]);
  return url;
}

/**
 * The opened file's content, shared by the rail and the expanded dialog: an
 * image inline, a PDF through the browser's viewer, Markdown or plain text, and
 * anything else as an honest handle rather than a guess in the wrong alphabet.
 */
function FileBody({
  file,
  raw,
  converted,
  converting,
  conversionFailure,
}: {
  readonly file: QaWorkspaceFile;
  readonly raw: boolean;
  /** The PDF the Host rendered out of this file, when it is convertible. */
  readonly converted: QaDocumentPreview | undefined;
  readonly converting: boolean;
  readonly conversionFailure: string;
}) {
  const nativePdf =
    file.mime === "application/pdf" && !file.truncated
      ? file.base64
      : undefined;
  const pdf = usePdfUrl(converted?.base64 ?? nativePdf);
  if (file.mime.startsWith("image/") && file.base64 !== undefined) {
    return (
      <img
        className="dsh-qa-ws__image"
        alt={entryName(file.path)}
        src={`data:${file.mime};base64,${file.base64}`}
      />
    );
  }
  if (pdf !== null) {
    return (
      <iframe
        className="dsh-qa-ws__pdf"
        title={entryName(file.path)}
        src={pdf}
      />
    );
  }
  if (converting) {
    return <p className="dsh-qa-ws__status">Готовлю предпросмотр…</p>;
  }
  if (file.text === undefined) {
    return (
      <p className="dsh-qa-ws__status">
        {isConvertibleDocument(file.mime)
          ? conversionFailure
          : file.truncated
            ? "Файл больше предела предпросмотра — показана только его часть."
            : "Файл не читается как текст — его можно скачать целиком."}
      </p>
    );
  }
  if (file.markdown && file.renderableMarkdown && !raw) {
    return <Markdown text={file.text} />;
  }
  return <pre className="dsh-qa-ws__text">{file.text}</pre>;
}

/** The opened file in the rail: chrome, the read/write toggles, and the body. */
function FilePreview({
  file,
  status,
  raw,
  converted,
  converting,
  conversionFailure,
  onToggleRaw,
  onBack,
  onExpand,
}: {
  readonly file: QaWorkspaceFile | undefined;
  readonly status: "loading" | "ready" | "refused";
  readonly raw: boolean;
  readonly converted: QaDocumentPreview | undefined;
  readonly converting: boolean;
  readonly conversionFailure: string;
  readonly onToggleRaw: () => void;
  readonly onBack: () => void;
  readonly onExpand: () => void;
}) {
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
          className="dsh-qa-ws__expand"
          aria-label="Развернуть файл"
          title="Развернуть"
          onClick={onExpand}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M5.5 2.25H2.25v3.25m6.25-3.25h3.25v3.25m0 3.25v3.25H8.5m-6.25-3.25v3.25h3.25" />
          </svg>
        </button>
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
          onClick={onToggleRaw}
        >
          {raw ? "Показать разметкой" : "Показать исходником"}
        </button>
      ) : null}
      <FileBody
        file={file}
        raw={raw}
        converted={converted}
        converting={converting}
        conversionFailure={conversionFailure}
      />
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
  const [converted, setConverted] = useState<QaDocumentPreview | undefined>(
    undefined,
  );
  const [converting, setConverting] = useState(false);
  const [conversionFailure, setConversionFailure] = useState("");
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);
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

  /**
   * Ask the Host for a renderable copy when the bytes themselves are not
   * drawable — a Word document arrives as the PDF the document pipeline made of
   * it. The panel keeps the file's own bytes either way, so download never
   * depends on the conversion succeeding.
   */
  const convert = useCallback(
    (path: string) => {
      setConverted(undefined);
      setConversionFailure("");
      setConverting(true);
      api.previewWorkspaceDocument(sessionId, path).then(
        (result) => {
          setOpened((current) => {
            if (current !== path) return current;
            setConverting(false);
            if (result.ok) {
              setConverted(result.value);
            } else {
              setConversionFailure(sourcePreviewFailureCopy(result.error));
            }
            return current;
          });
        },
        (failure: unknown) => {
          setOpened((current) => {
            if (current !== path) return current;
            setConverting(false);
            setConversionFailure(sourcePreviewFailureCopy(failure));
            return current;
          });
        },
      );
    },
    [api, sessionId],
  );

  const openFile = useCallback(
    (path: string) => {
      setOpened(path);
      setFile(undefined);
      setFileStatus("loading");
      setConverted(undefined);
      setConversionFailure("");
      setConverting(false);
      setRaw(false);
      setExpanded(false);
      api.readWorkspaceFile(sessionId, path).then(
        (result) => {
          setOpened((current) => {
            if (current !== path) return current;
            if (result.ok) {
              setFile(result.value);
              setFileStatus("ready");
              if (isConvertibleDocument(result.value.mime)) convert(path);
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
    [api, convert, sessionId],
  );

  if (opened !== null) {
    const closeFile = () => {
      setOpened(null);
      setFile(undefined);
      setExpanded(false);
    };
    return (
      <div className="dsh-qa-ws">
        <FilePreview
          file={file}
          status={fileStatus}
          raw={raw}
          converted={converted}
          converting={converting}
          conversionFailure={conversionFailure}
          onToggleRaw={() => setRaw((value) => !value)}
          onBack={closeFile}
          onExpand={() => setExpanded(true)}
        />
        <QaModal
          open={expanded && file !== undefined}
          size="document"
          title={file === undefined ? "" : entryName(file.path)}
          closeLabel="Закрыть файл"
          onClose={() => setExpanded(false)}
        >
          <div className="dsh-qa-ws__expanded">
            <p className="dsh-qa-ws__meta">
              {formatFileSize(file?.size ?? 0)}
              {file?.truncated === true ? " · показана только часть файла" : ""}
            </p>
            {file === undefined ? null : (
              <FileBody
                file={file}
                raw={raw}
                converted={converted}
                converting={converting}
                conversionFailure={conversionFailure}
              />
            )}
          </div>
        </QaModal>
      </div>
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
