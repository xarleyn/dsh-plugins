import { addTokenAttribute, removeTokenAttribute } from "../dom.js";
import { waitForStableLayout } from "../geometry.js";
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
  readonly token: string;
}

function safeRepairId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new Error(`unsafe repair id: ${value}`);
  }
  return value;
}

function serializeDeclaration(property: string, value: string): string {
  if (property === "overflow-y" && value === "auto") return "overflow-y:auto";
  if (property === "overflow-x" && value === "auto") return "overflow-x:auto";
  if (property === "min-height" && value === "0px") return "min-height:0px";
  if (property === "min-width" && value === "0px") return "min-width:0px";
  if (property === "flex-shrink" && value === "0") return "flex-shrink:0";
  if (property === "max-width" && value === "100%") return "max-width:100%";
  if (property === "white-space" && value === "normal")
    return "white-space:normal";
  if (property === "overflow-wrap" && value === "anywhere") {
    return "overflow-wrap:anywhere";
  }
  if (
    (property === "width" ||
      property === "height" ||
      property === "column-gap" ||
      property === "padding-top" ||
      property === "padding-right" ||
      property === "padding-bottom" ||
      property === "padding-left") &&
    /^\d+(?:\.\d+)?px$/u.test(value)
  ) {
    return `${property}:${value}`;
  }
  if (property === "translate" && /^-?\d+(?:\.\d+)?px 0$/u.test(value)) {
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

  owns(candidate: RepairCandidate): boolean {
    return this.#applied.get(candidate.issue.id)?.candidate === candidate;
  }

  activeOn(target: HTMLElement): readonly RepairCandidate[] {
    return [...this.#applied.values()]
      .map(({ candidate }) => candidate)
      .filter((candidate) => candidate.target === target);
  }

  verifiedCandidates(): readonly RepairCandidate[] {
    return [...this.#applied.values()]
      .filter(
        ({ historyIndex }) =>
          this.#history[historyIndex]?.status === "verified",
      )
      .map(({ candidate }) => candidate);
  }

  apply(candidate: RepairCandidate): boolean {
    const repairId = safeRepairId(candidate.issue.id);
    if (this.#applied.has(repairId)) return false;
    const changes = candidate.issue.suggestedCss;
    if (changes === undefined || Object.keys(changes).length === 0)
      return false;

    const declarations = Object.entries(changes)
      .map(([property, value]) => serializeDeclaration(property, value))
      .join(";");
    const nonce = (
      this.#document.defaultView?.crypto ?? globalThis.crypto
    ).getRandomValues(new Uint32Array(4));
    const token = `${repairId}-${Array.from(nonce, (value) => value.toString(16)).join("-")}`;
    const rootSelector = `[${ROOT_ATTRIBUTE}~="${token}"]`;
    const targetSelector = `[${TARGET_ATTRIBUTE}~="${token}"]`;
    const style = this.#document.createElement("style");
    style.dataset.dshUiRepairStyle = repairId;
    style.textContent =
      `${rootSelector} ${targetSelector},` +
      `${rootSelector}${targetSelector}{${declarations}}`;

    addTokenAttribute(candidate.root, ROOT_ATTRIBUTE, token);
    addTokenAttribute(candidate.target, TARGET_ATTRIBUTE, token);
    this.#document.head.append(style);
    const historyIndex =
      this.#history.push({
        repairId,
        timestamp: new Date().toISOString(),
        issue: candidate.issue,
        status: "applied",
      }) - 1;
    this.#applied.set(repairId, { candidate, style, historyIndex, token });
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

  rollback(repairId: string, verification?: RepairVerification): boolean {
    const applied = this.#applied.get(repairId);
    if (applied === undefined) return false;
    applied.style.remove();
    removeTokenAttribute(applied.candidate.root, ROOT_ATTRIBUTE, applied.token);
    removeTokenAttribute(
      applied.candidate.target,
      TARGET_ATTRIBUTE,
      applied.token,
    );
    this.#applied.delete(repairId);
    this.#history[applied.historyIndex] = {
      ...this.#history[applied.historyIndex]!,
      status:
        verification === undefined ? "rolled-back" : "verification-failed",
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

export async function applyVerified(
  engine: RepairEngine,
  candidate: RepairCandidate,
  stillCurrent: () => boolean,
): Promise<"verified" | "rolled-back" | "skipped"> {
  const id = candidate.issue.id;
  try {
    if (
      !stillCurrent() ||
      !candidate.root.isConnected ||
      !candidate.target.isConnected ||
      !engine.apply(candidate)
    )
      return "skipped";
    const stable = await waitForStableLayout(candidate.target);
    if (!engine.owns(candidate)) return "skipped";
    if (
      !stillCurrent() ||
      !candidate.root.isConnected ||
      !candidate.target.isConnected
    ) {
      engine.rollback(id);
      return "skipped";
    }
    const verification = stable
      ? candidate.verify()
      : { ok: false, reason: "layout did not stabilize" };
    if (verification.ok)
      return engine.markVerified(id, verification) ? "verified" : "skipped";
    engine.rollback(id, verification);
    return "rolled-back";
  } catch (error) {
    if (engine.owns(candidate))
      engine.rollback(id, {
        ok: false,
        reason: `repair failed: ${String(error)}`,
      });
    return "rolled-back";
  }
}
