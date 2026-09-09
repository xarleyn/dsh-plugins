import { collectRoots, DEFAULT_ROOT_SELECTOR } from "./dom.js";
import { waitForStableLayout } from "./geometry.js";
import { RepairEngine } from "./repair/engine.js";
import {
  scanIconAlignment,
  scanIconSizeConsistency,
} from "./scanner/alignment.js";
import { scanFlexConstraints } from "./scanner/flex.js";
import { scanOverflow } from "./scanner/overflow.js";
import { scanRowAlignment } from "./scanner/rows.js";
import type {
  RepairCandidate,
  RepairHistoryEntry,
  RepairMode,
  ScanReport,
  UIRepairConfig,
  UIRepairService,
} from "./types.js";
import type { UIRepairIgnoreRule } from "../shared/config.js";

export interface ClientLogger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export const DEFAULT_CONFIG: UIRepairConfig = {
  enabled: true,
  mode: "observe",
  autoConfidence: 0.95,
  dangerousConfidence: 0.98,
  rootSelector: DEFAULT_ROOT_SELECTOR,
  scanOnStartup: true,
  observeMutations: true,
  observeResize: true,
  ignore: [],
  maxElementsPerRoot: 300,
  alignmentTolerancePx: 1.5,
  overflowTolerancePx: 1,
};

function normalizeConfig(
  input: Partial<UIRepairConfig> = {},
): UIRepairConfig {
  const autoConfidence = Math.min(
    1,
    Math.max(0, input.autoConfidence ?? DEFAULT_CONFIG.autoConfidence),
  );
  return {
    ...DEFAULT_CONFIG,
    ...input,
    autoConfidence,
    dangerousConfidence: Math.max(
      0.98,
      autoConfidence,
      Math.min(
        1,
        Math.max(
          0,
          input.dangerousConfidence ?? DEFAULT_CONFIG.dangerousConfidence,
        ),
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
  #resizeObserver: ResizeObserver | undefined;
  readonly #resizeTargets = new Set<HTMLElement>();
  #queuedRoots = new Set<ParentNode>();
  #scheduledFrame: number | undefined;
  #disposed = false;
  #started = false;
  #revision = 0;
  readonly #listeners = new Set<() => void>();
  readonly #candidates = new Map<string, RepairCandidate>();

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
    if (this.#disposed || this.#started) return;
    this.#started = true;
    if (this.#config.enabled && this.#config.scanOnStartup) {
      void this.scan().catch((error: unknown) => {
        this.#logger.error("initial scan failed", { error: String(error) });
      });
    }
    this.#syncObservers();
  }

  configure(config: Partial<UIRepairConfig>): void {
    const previous = this.#config;
    this.#config = normalizeConfig({ ...this.#config, ...config });
    const autoPolicyChanged =
      previous.mode === "auto" &&
      (config.mode !== undefined ||
        config.autoConfidence !== undefined ||
        config.dangerousConfidence !== undefined ||
        config.ignore !== undefined);
    if (
      (!this.#config.enabled && previous.enabled) ||
      autoPolicyChanged
    ) {
      this.rollbackAll();
    }
    if (this.#started) this.#syncObservers();
  }

  #syncObservers(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#resizeTargets.clear();
    if (
      this.#disposed ||
      !this.#started ||
      !this.#config.enabled ||
      this.#document.body === null
    ) {
      return;
    }
    const view = this.#document.defaultView;
    const MutationObserverConstructor = view?.MutationObserver;
    if (
      this.#config.observeMutations &&
      MutationObserverConstructor !== undefined
    ) {
      this.#observer = new MutationObserverConstructor((records) => {
        for (const record of records) {
          if (view !== null && record.target instanceof view.Node) {
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
    const ResizeObserverConstructor = view?.ResizeObserver;
    if (this.#config.observeResize && ResizeObserverConstructor !== undefined) {
      this.#resizeObserver = new ResizeObserverConstructor((entries) => {
        for (const entry of entries) this.#queueScan(entry.target);
      });
      this.#observeResizeRoots(
        collectRoots(this.#document, this.#config.rootSelector),
      );
    }
  }

  async scan(source: ParentNode = this.#document): Promise<ScanReport> {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    if (!this.#config.enabled) {
      this.#candidates.clear();
      const report: ScanReport = {
        startedAt,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        mode: this.#config.mode,
        rootsScanned: 0,
        issues: [],
        applied: [],
        rolledBack: [],
        ignored: [],
      };
      this.#latestReport = report;
      this.#notify();
      return report;
    }
    const roots = collectRoots(source, this.#config.rootSelector);
    const detected: RepairCandidate[] = [];
    for (const root of roots) {
      detected.push(
        ...scanOverflow(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
        ...scanIconAlignment(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
        ...scanIconSizeConsistency(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
        ...scanFlexConstraints(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
        ...scanRowAlignment(root, this.#config, (ruleId, target) =>
          this.#idFor(ruleId, target),
        ),
      );
    }
    this.#observeResizeRoots(roots);
    this.#candidates.clear();
    for (const candidate of detected) {
      this.#candidates.set(candidate.issue.id, candidate);
    }
    const candidates = Array.from(this.#candidates.values());

    const applied: string[] = [];
    const rolledBack: string[] = [];
    const ignored = candidates
      .filter((candidate) => this.#isIgnored(candidate, this.#config.ignore))
      .map((candidate) => candidate.issue.id);
    const ignoredSet = new Set(ignored);
    if (this.#config.mode === "auto") {
      for (const candidate of candidates) {
        const threshold =
          this.#isRisky(candidate.issue.ruleId)
            ? this.#config.dangerousConfidence
            : this.#config.autoConfidence;
        if (
          candidate.issue.confidence < threshold ||
          candidate.issue.suggestedCss === undefined ||
          ignoredSet.has(candidate.issue.id) ||
          this.#engine.has(candidate.issue.id)
        ) {
          continue;
        }
        const outcome = await this.#applyCandidate(candidate);
        if (outcome !== "skipped") {
          applied.push(candidate.issue.id);
        }
        if (outcome === "rolled-back") {
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
      ignored,
    };
    this.#latestReport = report;
    this.#notify();
    if (report.issues.length > 0) {
      this.#logger.info("scan complete", {
        roots: report.rootsScanned,
        issues: report.issues.length,
        applied: report.applied.length,
        rolledBack: report.rolledBack.length,
        ignored: report.ignored.length,
      });
    }
    return report;
  }

  getLatestReport(): ScanReport | undefined {
    return this.#latestReport;
  }

  getRevision(): number {
    return this.#revision;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getHistory(): readonly RepairHistoryEntry[] {
    return this.#engine.history();
  }

  async apply(repairId: string): Promise<boolean> {
    if (!this.#config.enabled || this.#config.mode !== "suggest") return false;
    const knownCandidate = this.#candidates.get(repairId);
    if (
      knownCandidate === undefined ||
      !knownCandidate.root.isConnected ||
      !knownCandidate.target.isConnected
    ) {
      return false;
    }
    await this.scan(knownCandidate.root);
    const candidate = this.#candidates.get(repairId);
    if (
      candidate === undefined ||
      candidate.issue.suggestedCss === undefined ||
      this.#isIgnored(candidate, this.#config.ignore) ||
      !candidate.target.isConnected
    ) {
      return false;
    }
    const outcome = await this.#applyCandidate(candidate);
    if (outcome === "skipped") return false;
    if (this.#latestReport !== undefined) {
      this.#latestReport = {
        ...this.#latestReport,
        applied: Array.from(
          new Set([...this.#latestReport.applied, repairId]),
        ),
        rolledBack:
          outcome === "rolled-back"
            ? Array.from(
                new Set([...this.#latestReport.rolledBack, repairId]),
              )
            : this.#latestReport.rolledBack,
      };
    }
    this.#notify();
    this.#logger.info("manual repair complete", {
      repairId,
      ruleId: candidate.issue.ruleId,
      outcome,
    });
    return outcome === "verified";
  }

  getMode(): RepairMode {
    return this.#config.mode;
  }

  setMode(mode: RepairMode): void {
    this.configure({ mode });
  }

  rollback(repairId: string): boolean {
    const rolledBack = this.#engine.rollback(repairId);
    if (rolledBack) this.#notify();
    return rolledBack;
  }

  rollbackAll(): void {
    this.#engine.rollbackAll();
    this.#notify();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#observer?.disconnect();
    this.#resizeObserver?.disconnect();
    if (this.#scheduledFrame !== undefined) {
      this.#document.defaultView?.cancelAnimationFrame(this.#scheduledFrame);
    }
    this.#queuedRoots.clear();
    this.#resizeTargets.clear();
    this.rollbackAll();
    this.#listeners.clear();
  }

  #notify(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }

  #observeResizeRoots(roots: readonly HTMLElement[]): void {
    if (this.#resizeObserver === undefined) return;
    for (const target of this.#resizeTargets) {
      if (target.isConnected) continue;
      this.#resizeObserver.unobserve(target);
      this.#resizeTargets.delete(target);
    }
    for (const root of roots) {
      if (this.#resizeTargets.size >= 80) break;
      if (this.#resizeTargets.has(root) || !root.isConnected) continue;
      this.#resizeTargets.add(root);
      this.#resizeObserver.observe(root);
    }
  }

  #isRisky(ruleId: RepairCandidate["issue"]["ruleId"]): boolean {
    return ruleId === "R005" || ruleId === "R006" || ruleId === "R007";
  }

  async #applyCandidate(
    candidate: RepairCandidate,
  ): Promise<"verified" | "rolled-back" | "skipped"> {
    try {
      if (!this.#engine.apply(candidate)) return "skipped";
      const stable = await waitForStableLayout(candidate.target);
      const verification = stable
        ? candidate.verify()
        : { ok: false, reason: "layout did not stabilize" };
      if (verification.ok) {
        this.#engine.markVerified(candidate.issue.id, verification);
        return "verified";
      }
      this.#engine.rollback(candidate.issue.id, verification);
      return "rolled-back";
    } catch (error) {
      this.#engine.rollback(candidate.issue.id, {
        ok: false,
        reason: `repair failed: ${String(error)}`,
      });
      return "rolled-back";
    }
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

  #isIgnored(
    candidate: RepairCandidate,
    rules: readonly UIRepairIgnoreRule[],
  ): boolean {
    return rules.some((rule) => {
      if (rule.plugin !== undefined && rule.plugin !== candidate.issue.plugin) {
        return false;
      }
      if (rule.rule !== undefined && rule.rule !== candidate.issue.ruleId) {
        return false;
      }
      if (rule.selector !== undefined) {
        try {
          if (
            !candidate.target.matches(rule.selector) &&
            !candidate.root.matches(rule.selector)
          ) {
            return false;
          }
        } catch {
          return false;
        }
      }
      return (
        rule.plugin !== undefined ||
        rule.rule !== undefined ||
        rule.selector !== undefined
      );
    });
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
