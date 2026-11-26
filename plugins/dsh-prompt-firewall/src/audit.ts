import type {
  AuditConfig,
  FirewallDecision,
  FirewallSection,
  KnownSection,
  PromptAuditResult,
  PromptSectionAudit,
} from "./types.js";

const ANNOUNCEMENT_MARKERS = Object.freeze([
  "installed plugin",
  "本机已安装",
  "用户提到",
  "when user mentions",
]);

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function looksLikeAnnouncement(text: string): boolean {
  const normalized = text.toLocaleLowerCase("en-US");
  return ANNOUNCEMENT_MARKERS.some((marker) => normalized.includes(marker));
}

function auditDecision(
  decision: FirewallDecision,
): PromptSectionAudit["decision"] {
  if (decision.action === "block") return "blocked";
  if (decision.action === "protect") return "protected";
  return "allowed";
}

export function createSectionAudit(
  section: FirewallSection,
  decision: FirewallDecision,
  config: Readonly<AuditConfig>,
): PromptSectionAudit {
  const chars = section.text.length;
  return {
    name: section.name,
    decision: auditDecision(decision),
    reason: decision.reason,
    chars,
    estimatedTokens: estimateTokens(chars),
    ...(config.includePreview
      ? { preview: section.text.slice(0, config.previewChars) }
      : {}),
    ...(looksLikeAnnouncement(section.text) ? { suspicious: true } : {}),
  };
}

export function createAuditResult(
  sections: readonly FirewallSection[],
  decisions: readonly FirewallDecision[],
  config: Readonly<AuditConfig>,
  bypassReason?: string,
): PromptAuditResult {
  if (sections.length !== decisions.length) {
    throw new TypeError("section and decision counts must match");
  }

  const audited = sections.map((section, index) => {
    const decision = decisions[index];
    if (decision === undefined)
      throw new TypeError(`missing decision for section ${index}`);
    return createSectionAudit(section, decision, config);
  });
  const charsBefore = audited.reduce((sum, section) => sum + section.chars, 0);
  const charsRemoved = audited.reduce(
    (sum, section) =>
      sum + (section.decision === "blocked" ? section.chars : 0),
    0,
  );
  const blockedSections = audited.filter(
    (section) => section.decision === "blocked",
  ).length;
  const charsAfter = charsBefore - charsRemoved;

  return {
    timestamp: Date.now(),
    totalSections: audited.length,
    allowedSections: audited.length - blockedSections,
    blockedSections,
    charsBefore,
    charsAfter,
    charsRemoved,
    estimatedTokensBefore: estimateTokens(charsBefore),
    estimatedTokensAfter: estimateTokens(charsAfter),
    estimatedTokensRemoved: estimateTokens(charsRemoved),
    sections: audited,
    ...(bypassReason === undefined ? {} : { bypassed: true, bypassReason }),
  };
}

function cloneAudit(result: PromptAuditResult): PromptAuditResult {
  return {
    ...result,
    sections: result.sections.map((section) => ({ ...section })),
  };
}

function limitPreviews(result: PromptAuditResult, limit: number): void {
  for (const section of result.sections) {
    if (section.preview === undefined) continue;
    if (limit === 0) delete section.preview;
    else if (section.preview.length > limit)
      section.preview = section.preview.slice(0, limit);
  }
}

export class AuditStore {
  private readonly history: PromptAuditResult[] = [];
  private readonly known = new Map<string, KnownSection>();
  private previewLimit = Infinity;

  constructor(
    private historySize: number,
    private highlightNewSections: boolean,
  ) {}

  configure(
    historySize: number,
    highlightNewSections = this.highlightNewSections,
    previewLimit = this.previewLimit,
  ): void {
    this.historySize = historySize;
    this.highlightNewSections = highlightNewSections;
    if (this.history.length > historySize) {
      this.history.splice(0, this.history.length - historySize);
    }
    if (previewLimit < this.previewLimit) {
      for (const entry of this.history) limitPreviews(entry, previewLimit);
    }
    this.previewLimit = previewLimit;
  }

  record(result: PromptAuditResult): void {
    for (const section of result.sections) {
      const known = this.known.get(section.name);
      if (known === undefined) {
        if (this.highlightNewSections && section.name.startsWith("plugin:"))
          section.isNew = true;
        this.known.set(section.name, {
          name: section.name,
          firstSeenAt: result.timestamp,
          lastSeenAt: result.timestamp,
          observations: 1,
        });
      } else {
        known.lastSeenAt = result.timestamp;
        known.observations += 1;
      }
    }

    if (this.historySize === 0) return;
    const saved = cloneAudit(result);
    limitPreviews(saved, this.previewLimit);
    this.history.push(saved);
    if (this.history.length > this.historySize) this.history.shift();
  }

  last(): PromptAuditResult | null {
    const last = this.history.at(-1);
    return last === undefined ? null : cloneAudit(last);
  }

  entries(): PromptAuditResult[] {
    return this.history.map(cloneAudit);
  }

  knownSections(): KnownSection[] {
    return [...this.known.values()]
      .map((section) => ({ ...section }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}
