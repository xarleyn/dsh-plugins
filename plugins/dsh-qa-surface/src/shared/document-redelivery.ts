import type { QaArtifactView } from "../types/documents.js";
import { artifactsOfToolResult } from "../client/chat-artifacts.js";

export interface QaDocumentDelivery extends QaArtifactView {
  readonly sha256Prefix: string;
}

const normalize = (text: string) =>
  text.normalize("NFC").toLowerCase().replace(/ё/gu, "е").trim();

/** Only a standalone delivery request can reuse a previous output. */
export function requestedDocument(text: string): string | undefined {
  const request = normalize(text)
    .replace(/[,!?。]+/gu, " ")
    .replace(/\bplease\b|пожалуйста|еще\s+раз|повторно|снова|\bagain\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "");
  const target =
    /^(?:(?:можешь |можно )?(?:пришли(?:те)?|отправь(?:те)?|перешли(?:те)?|скинь(?:те)?|прикрепи(?:те)?|дай(?:те)?|прислать|отправить)|(?:re)?send|attach)\s+(?:(?:мне|сюда|me)\s+)?(?:(?:этот|тот же|тот|готовый|the same|the|that|this)\s+)?(.+)$/u.exec(
      request,
    )?.[1];
  if (!target) return;
  if (/^(?:файл|документ|docx|пми|file|document)$/u.test(target)) return "";
  const name = target
    .replace(/^(?:файл|документ|file|document)\s+/u, "")
    .replace(/^[«"`]|[»"`]$/gu, "");
  if (/^[^/\\<>:"`|?*\n]+\.docx$/u.test(name)) return name;
}

/** Names in prose never introduce paths or hashes into a download. */
export function deliveredDocuments(
  tool: string,
  output: string,
): QaDocumentDelivery[] {
  if (
    ![
      "document_create",
      "document_convert",
      "document_workflow_export",
    ].includes(tool)
  )
    return [];
  const result: QaDocumentDelivery[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const prefix = /,\s*sha256 ([a-f0-9]{16,64})(?:…|\.\.\.)?\)$/iu.exec(
      line.trim(),
    )?.[1];
    if (!prefix) continue;
    const file = artifactsOfToolResult(tool, line)[0];
    if (
      file?.format !== "docx" ||
      !file.name.toLowerCase().endsWith(".docx") ||
      file.path
        .split(/[\\/]/u)
        .some((segment) => !segment || segment === "." || segment === "..")
    )
      continue;
    result.push({ ...file, sha256Prefix: prefix.toLowerCase() });
  }
  return result;
}

export function selectDocument(
  files: Iterable<QaDocumentDelivery>,
  target: string,
) {
  const matches = new Map<string, QaDocumentDelivery>();
  for (const file of files) {
    if (target === "" || normalize(file.name) === target)
      matches.set(file.path, file);
  }
  return matches.size === 1 ? matches.values().next().value : undefined;
}
