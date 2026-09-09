import { addTokenAttribute, removeTokenAttribute } from "../dom.js";
import type {
  RepairCandidate,
  RepairHistoryEntry,
  RepairVerification,
} from "../types.js";

const ROOT_ATTRIBUTE = "data-dsh-ui-repair-scope";
const TARGET_ATTRIBUTE = "data-dsh-ui-repair-target";

interface AppliedRepair {
  readonly candidate: RepairCandidate;
  readonly style: HTMLStyleElement;
  readonly historyIndex: number;
}

function safeRepairId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new Error(`unsafe repair id: ${value}`);
  }
  return value;
}

function serializeDeclaration(property: string, value: string): string {
  if (property === "overflow-y" && value === "auto") return "overflow-y:auto";
  if (property === "min-height" && value === "0px") return "min-height:0px";
  if (
    property === "translate" &&
    /^-?\d+(?:\.\d+)?px 0$/u.test(value)
  ) {
    return `translate:${value}`;
  }
  throw new Error(`unsafe CSS repair declaration: ${property}: ${value}`);
}

export class RepairEngine {
  readonly #document: Document;
  readonly #applied = new Map<string, AppliedRepair>();
  readonly #history: RepairHistoryEntry[] = [];

  constructor(document: Document) {
    this.#document = document;
  }

  has(repairId: string): boolean {
    return this.#applied.has(repairId);
  }

  apply(candidate: RepairCandidate): boolean {
    const repairId = safeRepairId(candidate.issue.id);
    if (this.#applied.has(repairId)) return false;
    const changes = candidate.issue.suggestedCss;
    if (changes === undefined || Object.keys(changes).length === 0) return false;

    const declarations = Object.entries(changes)
      .map(([property, value]) => serializeDeclaration(property, value))
      .join(";");
    const rootSelector = `[${ROOT_ATTRIBUTE}~="${repairId}"]`;
    const targetSelector = `[${TARGET_ATTRIBUTE}~="${repairId}"]`;
    const style = this.#document.createElement("style");
    style.dataset.dshUiRepairStyle = repairId;
    style.textContent =
      `${rootSelector} ${targetSelector},` +
      `${rootSelector}${targetSelector}{${declarations}}`;

    addTokenAttribute(candidate.root, ROOT_ATTRIBUTE, repairId);
    addTokenAttribute(candidate.target, TARGET_ATTRIBUTE, repairId);
    this.#document.head.append(style);
    const historyIndex = this.#history.push({
      repairId,
      timestamp: new Date().toISOString(),
      issue: candidate.issue,
      status: "applied",
    }) - 1;
    this.#applied.set(repairId, { candidate, style, historyIndex });
    return true;
  }

  markVerified(repairId: string, verification: RepairVerification): boolean {
    const applied = this.#applied.get(repairId);
    if (applied === undefined) return false;
    this.#history[applied.historyIndex] = {
      ...this.#history[applied.historyIndex]!,
      status: "verified",
      verification,
    };
    return true;
  }

  rollback(
    repairId: string,
    verification?: RepairVerification,
  ): boolean {
    const applied = this.#applied.get(repairId);
    if (applied === undefined) return false;
    applied.style.remove();
    removeTokenAttribute(applied.candidate.root, ROOT_ATTRIBUTE, repairId);
    removeTokenAttribute(applied.candidate.target, TARGET_ATTRIBUTE, repairId);
    this.#applied.delete(repairId);
    this.#history[applied.historyIndex] = {
      ...this.#history[applied.historyIndex]!,
      status: verification === undefined
        ? "rolled-back"
        : "verification-failed",
      ...(verification === undefined ? {} : { verification }),
    };
    return true;
  }

  rollbackAll(): void {
    for (const repairId of Array.from(this.#applied.keys())) {
      this.rollback(repairId);
    }
  }

  history(): readonly RepairHistoryEntry[] {
    return this.#history.map((entry) => ({ ...entry }));
  }
}
