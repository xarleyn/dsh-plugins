import { Diagnostics } from "./diagnostics.js";
import type {
  DomTranslationAttribute,
  DomTranslationRule,
  TranslationPack,
} from "../types.js";

const DOM_TRANSLATION_ATTRIBUTES = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
]);
const EMPTY_DOM_RULES: readonly DomTranslationRule[] = Object.freeze([]);

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDomTranslationAttribute(
  value: unknown,
): value is DomTranslationAttribute {
  return typeof value === "string" && DOM_TRANSLATION_ATTRIBUTES.has(value);
}

function isDictionary(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDomRule(value: unknown): DomTranslationRule | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const rule = value as Record<string, unknown>;
  const source = rule.source;
  const target = rule.target;
  const scope = rule.scope;
  const mode = rule.mode;
  const rawAttributes = rule.attributes;
  if (
    !isNonBlankString(source) ||
    !isNonBlankString(target) ||
    !isNonBlankString(scope) ||
    (mode !== undefined && mode !== "exact") ||
    (rawAttributes !== undefined && !Array.isArray(rawAttributes))
  ) {
    return undefined;
  }

  let attributes: readonly DomTranslationAttribute[] | undefined;
  if (rawAttributes !== undefined) {
    const capturedAttributes: DomTranslationAttribute[] = [];
    const attributeCount = rawAttributes.length;
    for (let index = 0; index < attributeCount; index += 1) {
      const attribute = rawAttributes[index];
      if (!isDomTranslationAttribute(attribute)) return undefined;
      capturedAttributes.push(attribute);
    }
    attributes = Object.freeze(capturedAttributes);
  }
  return Object.freeze({
    source,
    target,
    scope,
    ...(mode === undefined ? {} : { mode }),
    ...(attributes === undefined ? {} : { attributes }),
  });
}

interface NormalizedTranslation {
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
}

interface NormalizedDomRules {
  readonly rules: readonly DomTranslationRule[];
  readonly invalidRuleIndexes: readonly number[];
  readonly invalidDeclaration: boolean;
}

function normalizeTranslations(
  value: unknown,
): readonly NormalizedTranslation[] | undefined {
  if (!isDictionary(value)) return undefined;

  const translations: NormalizedTranslation[] = [];
  for (const [namespace, dictionary] of Object.entries(value)) {
    if (!isDictionary(dictionary)) return undefined;

    for (const [key, translation] of Object.entries(dictionary)) {
      if (typeof translation !== "string") return undefined;
      translations.push(Object.freeze({ namespace, key, value: translation }));
    }
  }
  return Object.freeze(translations);
}

function normalizeDomRules(value: unknown): NormalizedDomRules {
  if (value === undefined) {
    return Object.freeze({
      rules: EMPTY_DOM_RULES,
      invalidRuleIndexes: Object.freeze([]),
      invalidDeclaration: false,
    });
  }
  if (!Array.isArray(value)) {
    return Object.freeze({
      rules: EMPTY_DOM_RULES,
      invalidRuleIndexes: Object.freeze([]),
      invalidDeclaration: true,
    });
  }

  const rules: DomTranslationRule[] = [];
  const invalidRuleIndexes: number[] = [];
  const ruleCount = value.length;
  for (let index = 0; index < ruleCount; index += 1) {
    try {
      const rule = normalizeDomRule(value[index]);
      if (rule === undefined) {
        invalidRuleIndexes.push(index);
      } else {
        rules.push(rule);
      }
    } catch {
      invalidRuleIndexes.push(index);
    }
  }
  return Object.freeze({
    rules: Object.freeze(rules),
    invalidRuleIndexes: Object.freeze(invalidRuleIndexes),
    invalidDeclaration: false,
  });
}

function safePackLabel(value: unknown): string {
  return isNonBlankString(value) ? `"${value}"` : "<unknown pack>";
}

export interface TranslationRegistryEntry {
  readonly value: string;
  readonly packId: string;
}

export interface TranslationRegistryStats {
  readonly packs: number;
  readonly localeOverrides: number;
  readonly domRules: number;
}

export class TranslationPackRegistry {
  readonly #translations = new Map<
    string,
    Map<string, Map<string, TranslationRegistryEntry>>
  >();
  readonly #packIds = new Set<string>();
  readonly #domRules: DomTranslationRule[] = [];
  #packCount = 0;
  #overrideCount = 0;

  constructor(private readonly diagnostics: Diagnostics) {}

  register(pack: TranslationPack): void {
    const source = pack as unknown as Record<string, unknown>;
    let rawPackId: unknown;
    try {
      rawPackId = source.id;
    } catch {
      this.diagnostics.error(
        "invalid_pack",
        "Pack <unknown pack> has an unreadable id and was ignored.",
      );
      return;
    }
    if (!isNonBlankString(rawPackId)) {
      this.diagnostics.error(
        "invalid_pack",
        `Pack ${safePackLabel(rawPackId)} has an invalid id and was ignored.`,
      );
      return;
    }
    const packId = rawPackId;

    if (this.#packIds.has(packId)) {
      this.diagnostics.error(
        "duplicate_pack_id",
        `Duplicate pack id "${packId}" ignored.`,
      );
      return;
    }

    let translations: readonly NormalizedTranslation[] | undefined;
    try {
      const rawTranslations = source.en;
      translations = normalizeTranslations(rawTranslations);
    } catch {
      translations = undefined;
    }
    if (translations === undefined) {
      this.diagnostics.error(
        "invalid_pack",
        `Pack "${packId}" has invalid English translations and was ignored.`,
      );
      return;
    }

    let normalizedDomRules: NormalizedDomRules;
    try {
      const rawDom = source.dom;
      normalizedDomRules = normalizeDomRules(rawDom);
    } catch {
      normalizedDomRules = Object.freeze({
        rules: EMPTY_DOM_RULES,
        invalidRuleIndexes: Object.freeze([]),
        invalidDeclaration: true,
      });
    }

    this.#packIds.add(packId);
    this.#packCount += 1;
    let namespaces = this.#translations.get("en");
    if (namespaces === undefined) {
      namespaces = new Map();
      this.#translations.set("en", namespaces);
    }

    for (const { namespace, key, value } of translations) {
      let entries = namespaces.get(namespace);
      if (entries === undefined) {
        entries = new Map();
        namespaces.set(namespace, entries);
      }

      const previous = entries.get(key);
      if (previous !== undefined) {
        this.diagnostics.error(
          "duplicate_override",
          `Duplicate override en/${namespace}/${key}: keeping pack "${previous.packId}"; ignoring pack "${packId}".`,
        );
        continue;
      }

      entries.set(key, Object.freeze({ value, packId }));
      this.#overrideCount += 1;
    }

    for (const rule of normalizedDomRules.rules) {
      this.#domRules.push(rule);
    }
    if (normalizedDomRules.invalidDeclaration) {
      this.diagnostics.error(
        "invalid_dom_rule",
        `Pack "${packId}" DOM rules declaration is invalid and was ignored.`,
      );
    }
    for (const index of normalizedDomRules.invalidRuleIndexes) {
      this.diagnostics.error(
        "invalid_dom_rule",
        `Pack "${packId}" DOM rule at index ${index} is invalid and was ignored.`,
      );
    }
    if (normalizedDomRules.rules.some((rule) => rule.scope === "global")) {
      this.diagnostics.warning(
        "global_dom_scope",
        `Pack "${packId}" contains global DOM translation rules.`,
      );
    }
  }

  resolve(locale: string, namespace: string, key: string): string | undefined {
    return this.resolveEntry(locale, namespace, key)?.value;
  }

  resolveEntry(
    locale: string,
    namespace: string,
    key: string,
  ): TranslationRegistryEntry | undefined {
    return this.#translations.get(locale)?.get(namespace)?.get(key);
  }

  getStats(): TranslationRegistryStats {
    return Object.freeze({
      packs: this.#packCount,
      localeOverrides: this.#overrideCount,
      domRules: this.#domRules.length,
    });
  }

  getDomRules(locale: string): readonly DomTranslationRule[] {
    return locale === "en"
      ? Object.freeze(this.#domRules.slice())
      : EMPTY_DOM_RULES;
  }
}
