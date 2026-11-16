import type { LightRagConfig } from "../config.js";
import { LIGHTRAG_DEFAULTS as D, QUERY_MODES } from "../settings.js";

export const NUMBER_FIELDS = [
  {
    key: "timeoutMs",
    path: ["timeoutMs"],
    label: "Таймаут запроса, мс",
    min: 1000,
    max: 300000,
    hint: "Общий срок ожидания заголовков и тела ответа. По умолчанию 60 000 мс.",
  },
  {
    key: "topK",
    path: ["query", "topK"],
    label: "Результатов поиска (top K)",
    min: 1,
    max: 200,
    hint: "Сколько элементов извлекать для одного вопроса.",
  },
  {
    key: "maxAnswerBytes",
    path: ["query", "maxAnswerBytes"],
    label: "Размер ответа, байт",
    min: 1024,
    max: 1048576,
    hint: "Длинный ответ обрезается по границе UTF-8.",
  },
  {
    key: "maxListed",
    path: ["documents", "maxListed"],
    label: "Документов в списке",
    min: 1,
    max: 1000,
    hint: "Максимум документов, возвращаемых за один вызов.",
  },
  {
    key: "maxTextBytes",
    path: ["writes", "maxTextBytes"],
    label: "Размер добавляемого текста, байт",
    min: 1024,
    max: 1048576,
    hint: "Текст сверх лимита отклоняется до отправки на сервер.",
  },
] as const;

export interface Draft {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  mode: string;
  timeoutMs: string;
  topK: string;
  maxAnswerBytes: string;
  maxListed: string;
  writesEnabled: boolean;
  maxTextBytes: string;
}

export function toDraft(config: LightRagConfig = {}): Draft {
  return {
    enabled: config.enabled ?? D.enabled,
    endpoint: config.endpoint ?? D.endpoint,
    apiKey: config.apiKey ?? "",
    mode: config.query?.mode ?? D.queryMode,
    timeoutMs: String(config.timeoutMs ?? D.timeoutMs),
    topK: String(config.query?.topK ?? D.queryTopK),
    maxAnswerBytes: String(
      config.query?.maxAnswerBytes ?? D.queryMaxAnswerBytes,
    ),
    maxListed: String(config.documents?.maxListed ?? D.documentsMaxListed),
    writesEnabled: config.writes?.enabled ?? D.writesEnabled,
    maxTextBytes: String(config.writes?.maxTextBytes ?? D.writesMaxTextBytes),
  };
}

export function validateDraft(draft: Draft): string | undefined {
  if (draft.endpoint.trim() !== "") {
    try {
      const url = new URL(draft.endpoint.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error();
    } catch {
      return "Укажите адрес http(s) сервера без пути, логина, пароля, параметров и фрагмента.";
    }
  }
  if (!QUERY_MODES.includes(draft.mode as (typeof QUERY_MODES)[number]))
    return "Выберите режим поиска из списка.";
  for (const field of NUMBER_FIELDS) {
    const text = draft[field.key].trim();
    if (text === "") continue;
    const value = Number(text);
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      return `${field.label}: введите целое число от ${field.min} до ${field.max}.`;
    }
  }
  return undefined;
}

/** Only changed leaves are written; inherited settings stay inherited. */
export function draftMutations(base: Draft, draft: Draft) {
  const entries: {
    key: keyof Draft;
    path: readonly string[];
    value: unknown;
  }[] = [
    { key: "enabled", path: ["enabled"], value: draft.enabled },
    {
      key: "endpoint",
      path: ["endpoint"],
      value: draft.endpoint.trim() || undefined,
    },
    { key: "apiKey", path: ["apiKey"], value: draft.apiKey.trim() },
    { key: "mode", path: ["query", "mode"], value: draft.mode },
    {
      key: "writesEnabled",
      path: ["writes", "enabled"],
      value: draft.writesEnabled,
    },
    ...NUMBER_FIELDS.map((field) => ({
      key: field.key,
      path: field.path,
      value:
        draft[field.key].trim() === "" ? undefined : Number(draft[field.key]),
    })),
  ];
  return entries
    .filter(({ key }) => base[key] !== draft[key])
    .map(({ path, value }) =>
      value === undefined
        ? { op: "unset" as const, path: [...path] }
        : { op: "set" as const, path: [...path], value: value as never },
    );
}
