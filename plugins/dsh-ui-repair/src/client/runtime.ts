import { collectRoots, DEFAULT_ROOT_SELECTOR } from "./dom.js";
import { waitForStableLayout } from "./geometry.js";
import { RepairEngine } from "./repair/engine.js";
import { scanIconAlignment } from "./scanner/alignment.js";
import { scanOverflow } from "./scanner/overflow.js";
import type {
  RepairCandidate,
  RepairHistoryEntry,
  RepairMode,
  ScanReport,
  UIRepairConfig,
  UIRepairService,
} from "./types.js";

export interface ClientLogger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export const DEFAULT_CONFIG: UIRepairConfig = {
  mode: "observe",
  autoConfidence: 0.95,
  dangerousConfidence: 0.98,
  rootSelector: DEFAULT_ROOT_SELECTOR,
  observeMutations: true,
  maxElementsPerRoot: 300,
  alignmentTolerancePx: 1.5,
  overflowTolerancePx: 1,
};

function normalizeConfig(
  input: Partial<UIRepairConfig> = {},
): UIRepairConfig {
  return {
    ...DEFAULT_CONFIG,
    ...input,
    autoConfidence: Math.min(
      1,
      Math.max(0, input.autoConfidence ?? DEFAULT_CONFIG.autoConfidence),
    ),
    dangerousConfidence: Math.min(
      1,
      Math.max(
        0,
        input.dangerousConfidence ?? DEFAULT_CONFIG.dangerousConfidence,
      ),
    ),
    maxElementsPerRoot: Math.max(
      1,
      Math.floor(
        input.maxElementsPerRoot ?? DEFAULT_CONFIG.maxElementsPerRoot,
      ),
    ),
  };
}

function defaultLogger(): ClientLogger {
  return {
    debug: (message, details) => console.debug(`[dsh-ui-repair] ${message}`, details),
    info: (message, details) => console.info(`[dsh-ui-repair] ${message}`, details),
    warn: (message, details) => console.warn(`[dsh-ui-repair] ${message}`, details),
    error: (message, details) => console.error(`[dsh-ui-repair] ${message}`, details),
  };
}

export class UIRepairRuntime implements UIRepairService {
  readonly #document: Document;
  readonly #logger: ClientLogger;
  readonly #engine: RepairEngine;
  readonly #elementIds = new WeakMap<HTMLElement, Map<string, string>>();
  #config: UIRepairConfig;
  #latestReport: ScanReport | undefined;
  #nextId = 1;
  #observer: MutationObserver | undefined;
  #queuedRoots = new Set<ParentNode>();
  #scheduledFrame: number | undefined;
  #disposed = false;

  constructor(
    document: Document,
    config: Partial<UIRepairConfig> = {},
    logger: ClientLogger = defaultLogger(),
  ) {
    this.#document = document;
    this.#config = normalizeConfig(config);
    this.#logger = logger;
    this.#engine = new RepairEngine(document);
  }

  start(): void {
    if (this.#disposed) return;
    void this.scan().catch((error: unknown) => {
      this.#logger.error("initial scan failed", { error: String(error) });
    });
    if (!this.#config.observeMutations || this.#document.body === null) return;
    const Observer = this.#document.defaultView?.MutationObserver;
    if (Observer === undefined) return;
    this.#observer = new Observer((records) => {
      for (const record of records) {
        if (record.target instanceof this.#document.defaultView!.Node) {
          this.#queueScan(record.target as ParentNode);
        }
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType === 1) this.#queueScan(node as ParentNode);
        }
      }
    });
    this.#observer.observe(this.#document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "open", "hidden", "aria-expanded"],
    });
  }

  async scan(source: ParentNode = this.#document): Promise<ScanReport> {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    const roots = collectRoots(source, this.#config.rootSelector);
    const candidates: RepairCandidate[] = [];
    for (const root of roots) {
      candidates.push(
        ...scanOverflow(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
        ...scanIconAlignment(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
      );
    }

    const applied: string[] = [];
    const rolledBack: string[] = [];
    if (this.#config.mode === "auto") {
      for (const candidate of candidates) {
        const threshold =
          candidate.issue.kind === "unexpected-overflow-y" ||
          candidate.issue.kind === "clipped-content"
            ? this.#config.dangerousConfidence
            : this.#config.autoConfidence;
        if (
          candidate.issue.confidence < threshold ||
          candidate.issue.suggestedCss === undefined ||
          this.#engine.has(candidate.issue.id)
        ) {
          continue;
        }
        try {
          if (!this.#engine.apply(candidate)) continue;
          applied.push(candidate.issue.id);
          const stable = await waitForStableLayout(candidate.target);
          const verification = stable
            ? candidate.verify()
            : { ok: false, reason: "layout did not stabilize" };
          if (verification.ok) {
            this.#engine.markVerified(candidate.issue.id, verification);
          } else {
            this.#engine.rollback(candidate.issue.id, verification);
            rolledBack.push(candidate.issue.id);
          }
        } catch (error) {
          this.#engine.rollback(candidate.issue.id, {
            ok: false,
            reason: `repair failed: ${String(error)}`,
          });
          rolledBack.push(candidate.issue.id);
        }
      }
    }

    const report: ScanReport = {
      startedAt,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      mode: this.#config.mode,
      rootsScanned: roots.length,
      issues: candidates.map(({ issue }) => issue),
      applied,
      rolledBack,
    };
    this.#latestReport = report;
    if (report.issues.length > 0) {
      this.#logger.info("scan complete", {
        roots: report.rootsScanned,
        issues: report.issues.length,
        applied: report.applied.length,
        rolledBack: report.rolledBack.length,
      });
    }
    return report;
  }

  getLatestReport(): ScanReport | undefined {
    return this.#latestReport;
  }

  getHistory(): readonly RepairHistoryEntry[] {
    return this.#engine.history();
  }

  getMode(): RepairMode {
    return this.#config.mode;
  }

  setMode(mode: RepairMode): void {
    this.#config = { ...this.#config, mode };
  }

  rollback(repairId: string): boolean {
    return this.#engine.rollback(repairId);
  }

  rollbackAll(): void {
    this.#engine.rollbackAll();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#observer?.disconnect();
    if (this.#scheduledFrame !== undefined) {
      this.#document.defaultView?.cancelAnimationFrame(this.#scheduledFrame);
    }
    this.#queuedRoots.clear();
    this.rollbackAll();
  }

  #idFor(ruleId: string, target: HTMLElement): string {
    let ids = this.#elementIds.get(target);
    if (ids === undefined) {
      ids = new Map();
      this.#elementIds.set(target, ids);
    }
    const existing = ids.get(ruleId);
    if (existing !== undefined) return existing;
    const id = `${ruleId.toLowerCase()}-${this.#nextId}`;
    this.#nextId += 1;
    ids.set(ruleId, id);
    return id;
  }

  #queueScan(source: ParentNode): void {
    if (this.#disposed) return;
    this.#queuedRoots.add(source);
    if (this.#scheduledFrame !== undefined) return;
    const schedule = this.#document.defaultView?.requestAnimationFrame;
    if (schedule === undefined) {
      const queued = Array.from(this.#queuedRoots);
      this.#queuedRoots.clear();
      for (const root of queued) void this.scan(root);
      return;
    }
    this.#scheduledFrame = schedule.call(this.#document.defaultView, () => {
      this.#scheduledFrame = undefined;
      const queued = Array.from(this.#queuedRoots);
      this.#queuedRoots.clear();
      for (const root of queued) {
        void this.scan(root).catch((error: unknown) => {
          this.#logger.warn("targeted scan failed", { error: String(error) });
        });
      }
    });
  }
}
