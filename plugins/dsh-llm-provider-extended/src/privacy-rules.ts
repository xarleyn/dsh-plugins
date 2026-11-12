/** Shared by the host and the local settings preview. No network or storage. */
export interface PrivacySettings {
  enabled?: boolean;
  dictionary?: string;
  dictionaryEnv?: string;
  masks?: string;
}

interface Rule {
  kind: string;
  pattern: RegExp;
  valueGroup?: number;
  accepts?: (match: RegExpMatchArray) => boolean;
}

/** Diagnostics from the filter never include the matched text or a dictionary entry. */
export class PrivacyError extends Error {}

/** Tokens are recognized only by exact lookup in the current request. */
export const aliasPattern = /\[([A-Z]+)_[1-9]\d*_[a-z0-9]+\]/gu;

const amount = String.raw`[+−-]?\d+(?:[.,]\d+|[ \u00a0\u202f']\d{3}(?!\d))*`;
const currency = String.raw`(?:[₽$€£¥]|(?:руб(?:лей|ля|ль)?\.?|р\.|доллар(?:ов|а)?|евро|rur|rub|usd|eur|gbp|cny)(?!\p{L}))`;
const scale = String.raw`(?:(?:тыс\.?|млн|млрд)[ \t\u00a0\u202f]*)?`;
const space = String.raw`[ \t\u00a0\u202f]*`;
const name = String.raw`\p{Lu}[\p{Ll}]+(?:-\p{Lu}[\p{Ll}]+)?`;
const russianWord = String.raw`[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?`;
const surname = String.raw`[А-ЯЁ][а-яё]+(?:ов|ев|ёв|ин|ын|ова|ева|ёва|ина|ына|ский|ская|цкий|цкая|енко)`;
const patronymic = String.raw`[А-ЯЁ][а-яё]+(?:ович|евич|овна|евна|ична|инична)`;
const builtins: Rule[] = [
  {
    kind: "EMAIL",
    pattern:
      /(?<![\p{L}\p{N}_.+%-])[\p{L}\p{N}_.+%-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu,
  },
  {
    kind: "PHONE",
    pattern:
      /(?<!\d)(?:\+7|8)[ (\u00a0-]*\d{3}[ )\u00a0-]*\d{3}[ \u00a0-]*\d{2}[ \u00a0-]*\d{2}(?!\d)/gu,
  },
  // Consume each number once, including long runs of grouped digits without a currency.
  {
    kind: "AMOUNT",
    pattern: new RegExp(
      String.raw`(?:(?<!\p{L})(${currency})${space})?${amount}(?:${space}${scale}(${currency}))?`,
      "giu",
    ),
    accepts: (match) => Boolean(match[1] || match[2]),
  },
  // Capture only the value, retaining the label for the model.
  {
    kind: "AMOUNT",
    valueGroup: 1,
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:сумма|цена|стоимость|зарплата|оклад|бюджет|выручка|salary|budget|price|amount)(?:[ \t]*[:=–—][ \t]*|[ \t]+)(${amount})`,
      "giu",
    ),
  },
  {
    kind: "CLIENT",
    valueGroup: 1,
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:[Кк]лиент(?:ка|а|у)?|[Зз]аказчик(?:а|у)?|[Фф][Ии][Оо]|[Cc]lient|[Cc]ustomer)(?:[ \t]*[:=–—-][ \t]*|[ \t]+)(${name}(?:[ \t]+${name}){0,2})`,
      "gu",
    ),
  },
  {
    kind: "CLIENT",
    pattern: new RegExp(
      String.raw`(?<!\p{L})${russianWord}[ \t]+(?:${russianWord}[ \t]+${patronymic}|${patronymic}(?:[ \t]+${russianWord})?)(?!\p{L})`,
      "gu",
    ),
  },
  {
    kind: "CLIENT",
    pattern: new RegExp(
      String.raw`(?<!\p{L})(?:${surname}[ \t]+${russianWord}|${russianWord}[ \t]+${surname})(?!\p{L})`,
      "gu",
    ),
  },
];

function lines(value: string | undefined, field: string): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string" || value.length > 32768)
    throw new PrivacyError(
      `Privacy ${field} must be text of at most 32768 characters`,
    );
  const entries = [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (entries.length > 256 || entries.some((v) => v.length > 128))
    throw new PrivacyError(
      `Privacy ${field} allows 256 entries of up to 128 characters each`,
    );
  return entries;
}

function literal(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function maskPattern(mask: string, index: number): string {
  let pattern = "";
  let escaped = false;
  let wildcard = false;
  for (const ch of mask) {
    if (!escaped && ch === "\\") {
      escaped = true;
      continue;
    }
    if (!escaped && (ch === "#" || ch === "@")) {
      pattern += ch === "#" ? "[0-9]" : "\\p{L}";
      wildcard = true;
    } else {
      pattern += literal(ch);
    }
    escaped = false;
  }
  if (escaped || !wildcard)
    throw new PrivacyError(
      `Privacy mask on line ${index + 1} needs a # or @ wildcard and complete escapes`,
    );
  return pattern;
}

/** A lookahead also finds overlapping literals. Longest wins at the same offset. */
function customRule(kind: string, entries: string[], masks = false): Rule[] {
  if (!entries.length) return [];
  const alternatives = entries
    .map((entry, i) => ({
      size: masks
        ? [...entry.replace(/\\(.)/gu, "$1")].length
        : [...entry].length,
      source: masks ? maskPattern(entry, i) : literal(entry),
    }))
    .sort((a, b) => b.size - a.size);
  return [
    {
      kind,
      valueGroup: 1,
      pattern: new RegExp(
        `(?=(${alternatives.map((item) => item.source).join("|")}))`,
        "giu",
      ),
    },
  ];
}

export function compilePrivacyRules(
  settings: PrivacySettings,
  privateDictionary?: string,
): Rule[] {
  if (
    settings.dictionaryEnv !== undefined &&
    !/^DSH_PII_[A-Z0-9_]{1,64}$/u.test(settings.dictionaryEnv)
  )
    throw new PrivacyError(
      "Private dictionary reference must start with DSH_PII_ and contain uppercase letters, digits or underscores",
    );
  return [
    ...customRule("CLIENT", [
      ...lines(settings.dictionary, "dictionary"),
      ...lines(privateDictionary, "private dictionary"),
    ]),
    ...customRule("CUSTOM", lines(settings.masks, "masks"), true),
    ...builtins,
  ];
}

interface Span {
  from: number;
  to: number;
  kind: string;
}

/** Alias allocation belongs to one request. The preview uses its own instance. */
export class PrivacyFilter {
  private readonly aliases = new Map<string, string>();
  private readonly originals = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly names = new Set<string>();
  private readonly bareAmounts = new Set<string>();
  private readonly historyAmountRule: Rule = {
    kind: "AMOUNT",
    pattern: new RegExp(String.raw`(?<![\p{L}\d])${amount}(?![\p{L}\d])`, "gu"),
    accepts: (match) => this.bareAmounts.has(match[0]),
  };
  private remaining = 4_000_000;
  private remainingMatches = 32768;

  constructor(
    private readonly rules: Rule[],
    private readonly namespace: string,
  ) {}

  get replyAliases(): ReadonlyMap<string, string> {
    return this.originals;
  }

  isReplyAliasPrefix(text: string): boolean {
    if (text.length > this.namespace.length + 16) return false;
    for (const [kind, count] of this.counts) {
      const head = `[${kind}_`;
      if (head.startsWith(text)) return true;
      if (!text.startsWith(head)) continue;
      const digits = /^([1-9]\d{0,4})(?:_([a-z0-9]*))?$/u.exec(
        text.slice(head.length),
      );
      if (
        digits &&
        Number(digits[1]) <= count &&
        (digits[2] === undefined || this.namespace.startsWith(digits[2]))
      )
        return true;
    }
    return false;
  }

  learnName(value: string): void {
    if (
      value.length > 128 ||
      (this.names.size >= 256 && !this.names.has(value))
    )
      throw new PrivacyError("Privacy detected-name limit exceeded");
    this.names.add(value);
  }

  learnText(text: string): void {
    for (const rule of builtins) {
      if (rule.kind === "AMOUNT" && rule.valueGroup) {
        for (const match of text.matchAll(rule.pattern))
          this.learnAmount(match[rule.valueGroup]!);
      } else if (rule.kind === "CLIENT") {
        for (const match of text.matchAll(rule.pattern))
          this.learnName(match[rule.valueGroup ?? 0]!);
      }
    }
  }

  learnAmount(value: string): void {
    this.bareAmounts.add(value);
  }

  useLearnedNames(): void {
    this.rules.push(...customRule("CLIENT", [...this.names]));
  }

  alias(kind: string, original: string): string {
    if (this.originals.has(original)) return original;
    const key =
      kind + "\0" + (kind === "CLIENT" ? original.toLowerCase() : original);
    const existing = this.aliases.get(key);
    if (existing !== undefined) return existing;
    if (this.aliases.size >= 32768)
      throw new PrivacyError("Privacy match limit exceeded");
    const number = (this.counts.get(kind) ?? 0) + 1;
    const tag = `[${kind}_${number}_${this.namespace}]`;
    this.counts.set(kind, number);
    this.aliases.set(key, tag);
    this.originals.set(tag, original);
    return tag;
  }

  text(value: string, conversationText = false): string {
    this.remaining -= value.length;
    if (this.remaining < 0)
      throw new PrivacyError("Privacy text limit exceeded");
    // History can already contain fresh aliases for locally restored spans.
    // A custom digit mask must not rewrite part of their random namespace.
    let start = 0;
    const parts: string[] = [];
    if (value.includes("[") && this.originals.size) {
      for (const match of value.matchAll(aliasPattern)) {
        if (!this.originals.has(match[0])) continue;
        parts.push(
          this.maskPlain(value.slice(start, match.index), conversationText),
          match[0],
        );
        start = match.index + match[0].length;
      }
    }
    if (!start) return this.maskPlain(value, conversationText);
    parts.push(this.maskPlain(value.slice(start), conversationText));
    return parts.join("");
  }

  private maskPlain(value: string, conversationText: boolean): string {
    const spans: Span[] = [];
    const rules =
      conversationText && this.bareAmounts.size
        ? [...this.rules, this.historyAmountRule]
        : this.rules;
    for (const { kind, pattern, valueGroup, accepts } of rules) {
      for (const match of value.matchAll(pattern)) {
        if (accepts && !accepts(match)) continue;
        const found = match[valueGroup ?? 0]!;
        const from = match.index + Math.max(0, match[0].length - found.length);
        if (--this.remainingMatches < 0)
          throw new PrivacyError("Privacy match limit exceeded");
        spans.push({ from, to: from + found.length, kind });
      }
    }
    if (!spans.length) return value;
    spans.sort((a, b) => a.from - b.from || b.to - a.to);
    const parts: string[] = [];
    let position = 0;
    for (let i = 0; i < spans.length;) {
      const { from, to, kind } = spans[i++]!;
      let end = to;
      while (i < spans.length && spans[i]!.from < end)
        end = Math.max(end, spans[i++]!.to);
      parts.push(
        value.slice(position, from),
        this.alias(kind, value.slice(from, end)),
      );
      position = end;
    }
    return parts.join("") + value.slice(position);
  }
}
