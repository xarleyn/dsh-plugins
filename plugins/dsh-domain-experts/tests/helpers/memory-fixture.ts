import type { MemoryRecord } from "../../src/types.js";
import {
  MAX_TEXT_LENGTH,
  type MemoryTable,
} from "../../src/host/memory/shared.js";
import { memoryTable } from "./fakes.js";

/**
 * A memory table shaped like the one a working stand had grown into, with
 * synthetic content only.
 *
 * The shape comes from a measured deployment (23.09: 30 records, 27 of them in
 * one namespace, texts of 235–1 632 characters averaging about 1 035, 2–9 tags
 * per record, one record already at the write-time truncation). The repository
 * is public and its history is permanent, so nothing here is that deployment's
 * text: an expert's note about a real product would put an internal identifier
 * in a fixture, and fixtures ship in the package.
 *
 * The shape is what makes the parity test worth running — it reproduces the mix
 * the migration faces, including the cases a smaller fixture skips: two records
 * tied on `updatedAt`, a namespace holding one record, a text at the cap.
 */

/** Namespaces the fixture writes into. */
export const FIXTURE_NAMESPACES = [
  "domain/answer-reviewer",
  "domain/payments",
  "domain/platform",
] as const;

const SENTENCES = [
  "Эксперт ответил про срез «Демо-продукт» уверенно, но сослался на настройку, которой в профиле нет.",
  "Answer cites the deployment profile correctly and names the source file it read.",
  "Проверено на двух сессиях: ответ тот же, поэтому пометку о галлюцинации снимаю.",
  "The candidate dropped the second half of the request; the reviewer must record which half.",
  "Материал берётся из корпуса docs, версия документа не указана — замечание повторилось трижды.",
  "Recall found the earlier verdict and the expert contradicted it without saying why.",
  "Тул docs_search вернул пусто, эксперт достал ответ из памяти — это нужный ход, но его видно в журнале.",
  "The answer lists PROJ-123 and PROJ-456 as evidence; both are synthetic placeholders in this fixture.",
  "Разбор: формулировка «обычно» без источника — просить ссылку на документ, а не на память.",
  "Model refused the write because the path guard is advisory for this worker; the answer stayed correct.",
  "Проверено в канареечном запуске: память перечитывается, namespace не смешивается с соседним доменом.",
  "The reviewer's own note was retrieved into the next run, which is the loop this record exists to break.",
];

/** Length of each record's text, mirroring the measured spread. */
const TEXT_LENGTHS = [
  235, 310, 420, 480, 560, 610, 700, 760, 820, 880, 940, 980, 1_010, 1_025,
  1_030, 1_035, 1_040, 1_045, 1_050, 1_060, 1_080, 1_100, 1_130, 1_160, 1_200,
  1_260, 1_632,
];

/** The measured length of record number `index`, cycling through the spread. */
function lengthAt(index: number): number {
  const length = TEXT_LENGTHS[index % TEXT_LENGTHS.length];
  if (length === undefined) throw new Error("the length table is empty");
  return length;
}

/** 26 of the fixture's 27 records in the reviewer's namespace. */
const REVIEWER_KEYS = [
  "review-2026-01-component-answer",
  "review-2026-skills-answer",
  "review-2026-skills-answer-v2",
  "review-2026-candidate-answer",
  "review-2026-dashboard-material-filtering",
  "review-2026-dashboard-material-filtering-final",
  "review-2026-skills-answer-v4-adversarial",
  "review-2026-skills-answer-v5-adversarial",
  "review-PROJ-123-candidate",
  "review-PROJ-123-adversarial-v2",
  "review-PROJ-456-candidate",
  "review-PROJ-456-follow-up",
  "review-demo-product-cutoff",
  "review-demo-product-cutoff-v2",
  "review-tool-refusal-write",
  "review-tool-refusal-write-v2",
  "review-corpus-empty-search",
  "review-corpus-empty-search-v2",
  "review-recall-contradiction",
  "review-recall-contradiction-v2",
  "review-namespace-mixing",
  "review-unsourced-hedge",
  "review-unsourced-hedge-v2",
  "review-version-pin-missing",
  "review-version-pin-missing-v2",
  "review-final-signoff",
];

const TAG_POOL = [
  "review",
  "hallucination",
  "recall",
  "corpus",
  "tool-refusal",
  "format",
  "cutoff",
  "sign-off",
  "adversarial",
];

function textOf(target: number, salt: number): string {
  let out = "";
  let index = salt % SENTENCES.length;
  while (out.length < target) {
    out += `${out === "" ? "" : " "}${SENTENCES[index % SENTENCES.length]}`;
    index += 1;
  }
  return out.slice(0, target);
}

/** A record whose text already carries the write-time truncation. */
function truncatedRecord(timestamp: number): MemoryRecord {
  const body = "Проверка обрезки длинного разбора. ".repeat(400);
  return {
    namespace: "domain/answer-reviewer",
    key: "review-long-answer-truncated",
    text: `${body.slice(0, MAX_TEXT_LENGTH)}…`,
    tags: ["review", "truncation"],
    createdAt: timestamp - 86_400_000,
    updatedAt: timestamp,
  };
}

/**
 * The 30 records, oldest first.
 *
 * Two pairs share `updatedAt` to the millisecond and one pair shares it across
 * namespaces: records written in one session do tie, and that is exactly where
 * a backend with a tie-break and one without it answer differently.
 */
export function productionShapedRecords(
  base = 1_758_000_000_000,
): MemoryRecord[] {
  const records: MemoryRecord[] = REVIEWER_KEYS.map((key, index) => {
    // Records written in one session do share a timestamp: indices 2/3 and 10/11
    // tie to the millisecond here, which is where two backends that break ties
    // differently answer in different orders.
    const minute = index + 1 - (index === 3 || index === 11 ? 1 : 0);
    const updatedAt = base + minute * 60_000;
    return {
      namespace: "domain/answer-reviewer",
      key,
      text: textOf(lengthAt(index), index),
      tags: TAG_POOL.slice(0, 2 + (index % 8)),
      createdAt: updatedAt - 3_600_000,
      updatedAt,
    };
  });
  records.push(truncatedRecord(base + 27 * 60_000));
  ["settlement-window", "settlement-window-v2"].forEach((key, index) => {
    const updatedAt = base + (40 + index * 5) * 60_000;
    records.push({
      namespace: "domain/payments",
      key,
      text: textOf(index === 0 ? 640 : 1_180, index + 5),
      tags: ["settlement", "cutoff", "review"],
      createdAt: updatedAt - 7_200_000,
      updatedAt,
    });
  });
  // Deliberately tied with the first payments record on updatedAt.
  records.push({
    namespace: "domain/platform",
    key: "subagent-tool-mask",
    text: textOf(235, 9),
    tags: ["platform"],
    createdAt: base + 41 * 60_000,
    updatedAt: base + 40 * 60_000,
  });
  return records;
}

/** Storage key of one record: the layout the built-in provider addresses by. */
export function storageKeyOf(record: MemoryRecord): string {
  return `${record.namespace}::${record.key}`;
}

/** The fixture records as a storage unit's memory table. */
export function fixtureMemoryTable(
  records = productionShapedRecords(),
): MemoryTable {
  return memoryTable<MemoryRecord>(
    records.map((record) => [storageKeyOf(record), record]),
  );
}

/** The same records as the JSON document a JSON backend holds and rewrites. */
export function fixtureUnitDocument(
  records: Iterable<MemoryRecord> = productionShapedRecords(),
): {
  unit: { name: string; version: number };
  global: Record<string, unknown>;
  tables: {
    domains: Record<string, unknown>;
    memory: Record<string, MemoryRecord>;
  };
} {
  const memory: Record<string, MemoryRecord> = {};
  for (const record of records) memory[storageKeyOf(record)] = record;
  return {
    unit: { name: "domain_experts", version: 1 },
    global: {},
    tables: { domains: {}, memory },
  };
}

/**
 * A table that costs what the JSON backend costs: every write serialises and
 * replaces the whole document. Used by the measurement run, which is skipped
 * unless a deployment asks for it.
 */
export function rewritingJsonTable(
  records: Iterable<MemoryRecord>,
  onWrite: (bytes: number) => void,
): MemoryTable {
  const store = new Map<string, MemoryRecord>();
  for (const record of records) store.set(storageKeyOf(record), record);
  const rewrite = (): void => {
    onWrite(
      Buffer.byteLength(JSON.stringify(fixtureUnitDocument(store.values()))),
    );
  };
  rewrite();
  return {
    get: (key) => store.get(key),
    entries: () => store.entries(),
    put: async (key, value) => {
      store.set(key, value);
      rewrite();
    },
    delete: async (key) => {
      const existed = store.delete(key);
      rewrite();
      return existed;
    },
  };
}

/** Records of a synthetic namespace, for the measurement run. */
export function recordsForSize(
  size: number,
  namespace: string,
): MemoryRecord[] {
  const base = 1_758_000_000_000;
  return Array.from({ length: size }, (_unused, index) => ({
    namespace,
    key: `note-${String(index)}`,
    text: textOf(lengthAt(index), index),
    tags: TAG_POOL.slice(0, 2 + (index % 8)),
    createdAt: base + index * 1_000,
    updatedAt: base + index * 1_000,
  }));
}

/**
 * The queries a deployment checks a migration against.
 *
 * Chosen to cover what two backends can disagree about: a hit in the key only,
 * a hit in a tag only, a Cyrillic term, a partial word that matches as a
 * substring, several terms with different scores, a query nothing matches, an
 * empty query, a tie inside one namespace and a tie across namespaces.
 */
export const FIXED_QUERIES: readonly {
  readonly label: string;
  readonly namespaces: readonly string[];
  readonly query: string;
  readonly limit: number;
  /** False where an empty answer is the point; a parity test of two empty lists proves nothing. */
  readonly matches?: boolean;
}[] = [
  {
    label: "key-only hit",
    namespaces: ["domain/answer-reviewer"],
    query: "adversarial",
    limit: 20,
  },
  {
    label: "tag-only hit",
    namespaces: ["domain/answer-reviewer"],
    query: "sign-off",
    limit: 20,
  },
  {
    label: "cyrillic term",
    namespaces: [...FIXTURE_NAMESPACES],
    query: "корпус",
    limit: 20,
  },
  {
    label: "partial word",
    namespaces: [...FIXTURE_NAMESPACES],
    query: "trunc",
    limit: 20,
  },
  {
    label: "several terms",
    namespaces: [...FIXTURE_NAMESPACES],
    query: "review docs_search version",
    limit: 20,
  },
  {
    label: "nothing matches",
    namespaces: [...FIXTURE_NAMESPACES],
    query: "kubernetes",
    limit: 20,
    matches: false,
  },
  {
    label: "empty query",
    namespaces: [...FIXTURE_NAMESPACES],
    query: "",
    limit: 5,
  },
  {
    label: "tight limit",
    namespaces: ["domain/answer-reviewer"],
    query: "review answer",
    limit: 3,
  },
  {
    label: "two namespaces",
    namespaces: ["domain/payments", "domain/platform"],
    query: "settlement cutoff",
    limit: 20,
  },
  {
    label: "tie inside one namespace",
    namespaces: ["domain/answer-reviewer"],
    query: "review",
    limit: 8,
  },
  {
    label: "tie across namespaces",
    namespaces: ["domain/payments", "domain/platform"],
    query: "cutoff",
    limit: 20,
  },
  {
    label: "limit above matches",
    namespaces: ["domain/platform"],
    query: "platform",
    limit: 500,
  },
];
