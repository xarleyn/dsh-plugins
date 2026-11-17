import type { QaArtifactView } from "../types/documents.js";
import { artifactsOfToolResult } from "../client/chat-artifacts.js";

export interface QaDocumentDelivery extends QaArtifactView {
  readonly sha256Prefix: string;
}

const normalize = (text: string) =>
  text.normalize("NFC").toLowerCase().replace(/ё/gu, "е").trim();

/** Only a standalone delivery request can reuse a previous output. */
export function requestedDocument(text: string): string | undefined {
  const request = normalize(text).replace(/[.!?。\s]+$/u, "");
  let target =
    /^(?:(?:please|пожалуйста)[,\s]+)?(?:(?:можешь |можно )?(?:пришли(?:те)?|отправь(?:те)?|перешли(?:те)?|скинь(?:те)?|прикрепи(?:те)?|дай(?:те)?|прислать|отправить)|(?:re)?send|attach)[,\s]+(.+)$/u.exec(
      request,
    )?.[1];
  if (!target) return;
  // Only trim conversational words at the edges, separated by whitespace or
  // commas. Inside a filename (including please-report.docx) they are data.
  target = target
    .replace(
      /^(?:(?:please|пожалуйста|again|еще\s+раз|повторно|снова)[,\s]+)+/u,
      "",
    )
    .replace(
      /(?:[,\s]+(?:please|пожалуйста|again|еще\s+раз|повторно|снова))+$/u,
      "",
    )
    .replace(
      /^(?:(?:мне|сюда|me)\s+)?(?:(?:этот|тот же|тот|готовый|the same|the|that|this)\s+)?/u,
      "",
    );
  if (/^(?:файл|документ|docx|пми|file|document)$/u.test(target)) return "";
  const filename = target.replace(/^(?:файл|документ|file|document)\s+/u, "");
  const quoted = /^(?:«[^»]+»|"[^"]+"|`[^`]+`)$/u.test(filename);
  const name = quoted ? filename.slice(1, -1) : filename;
  if (
    !quoted &&
    (name.match(/\.docx\b/gu)?.length !== 1 ||
      /(?:^|[\s,;])(?:and|then|with|without|create|edit|revise|update|и|а|затем|потом|исправ\p{L}*|созда\p{L}*|обнов\p{L}*|измен\p{L}*|добав\p{L}*|удал\p{L}*)(?=$|[\s,;])/u.test(
        name,
      ))
  )
    return;
  if (/^[^/\\<>:"`|?*\n]+\.docx$/u.test(name)) return name;
}

/** Select an explicit existing file for the answer without consuming any of
 * the user's other instructions. Modification requests keep their new output. */
export function requestedDocumentAttachment(text: string): string | undefined {
  const standalone = requestedDocument(text);
  if (standalone !== undefined) return standalone;
  const request = normalize(text);
  if (
    /(?:^|[.;!?\n—–]\s*|(?:^|[^\p{L}\p{N}_])(?:and|then|и|затем|потом)\s+)(?:(?:please|пожалуйста)[,\s]+)?(?:edit|revise|update|modify|change|rewrite|regenerate|исправ\p{L}*|измен\p{L}*|обнов\p{L}*|добав\p{L}*|удал\p{L}*|поправ\p{L}*|отредактир\p{L}*|перепиш\p{L}*)(?=$|[^\p{L}\p{N}_])/u.test(
      request,
    ) ||
    /\bwith changes\b|с изменениями/u.test(request)
  )
    return;
  const names: string[] = [];
  const verbs =
    /(?:^|[.!?;\n—–]\s*|(?:^|[^\p{L}\p{N}_])(?:and|then|и|затем|потом)\s+)(?:(?:please|пожалуйста)[,\s]+)?(?:resend|redeliver|send|attach|пришли(?:те)?|отправь(?:те)?|перешли(?:те)?|скинь(?:те)?|прикрепи(?:те)?)[,\s]+(?=([^\n]+))/gu;
  for (const match of request.matchAll(verbs)) {
    const tail = match[1]!
      .replace(
        /^(?:(?:again|ещ[её]\s+раз|повторно|снова|мне|сюда|me)[,\s]+)*/u,
        "",
      )
      .replace(
        /^(?:(?:the\s+)?(?:existing|same|готовый|существующий|тот же)\s+)?(?:(?:file|document|файл|документ)\s+)?/u,
        "",
      )
      .replace(
        /^(?:by (?:its |the )?(?:full )?(?:exact )?name|по (?:полному )?(?:точному )?имени)\s*:\s*/u,
        "",
      );
    const quoted =
      /^(?:«([^»]+\.docx)»|"([^"]+\.docx)"|`([^`]+\.docx)`)(?=$|[\s,;.!?])/u.exec(
        tail,
      );
    const bare = /^([^:;!?\n]+?\.docx)(?=$|[\s,;.!?])/u.exec(tail);
    const name = quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]) : bare?.[1];
    if (name && /^[^/\\<>:"`|?*\n]+\.docx$/u.test(name))
      names.push(name.trim());
  }
  return names.length === 1 ? names[0] : undefined;
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
