// Scope-selector parser for l10n override packs (SPEC §10-§11): recognizes
// the single escape-free compound selector accepted by v0.1 and reports the
// config dependencies it references. Full CSS validation stays with the
// browser's querySelector.
function isScopeIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Z_a-z\u0080-\uFFFF]/.test(character);
}

function consumeScopeIdentifier(scope: string, start: number): number {
  let index = start;
  if (scope[index] === "-") {
    index += 1;
    if (scope[index] === "-") index += 1;
    else if (!isScopeIdentifierStart(scope[index])) return start;
  } else if (isScopeIdentifierStart(scope[index])) {
    index += 1;
  } else {
    return start;
  }
  while (
    index < scope.length &&
    /[-0-9A-Z_a-z\u0080-\uFFFF]/.test(scope[index] ?? "")
  ) {
    index += 1;
  }
  return index;
}

function skipScopeWhitespace(scope: string, start: number): number {
  let index = start;
  while (index < scope.length && /[\t\n\f\r ]/.test(scope[index] ?? "")) {
    index += 1;
  }
  return index;
}

interface ParsedScopeAttribute {
  readonly dependency: string;
  readonly nextIndex: number;
}

function parseScopeAttribute(
  scope: string,
  start: number,
): ParsedScopeAttribute | undefined {
  let index = skipScopeWhitespace(scope, start + 1);
  const nameStart = index;
  if (!/[A-Z_a-z]/.test(scope[index] ?? "")) return undefined;
  index += 1;
  while (index < scope.length && /[-0-9A-Z_a-z]/.test(scope[index] ?? "")) {
    index += 1;
  }
  const dependency = scope.slice(nameStart, index).toLowerCase();
  index = skipScopeWhitespace(scope, index);
  if (scope[index] === "]") return { dependency, nextIndex: index + 1 };

  const operatorStart = scope[index];
  if (operatorStart === "=") {
    index += 1;
  } else if (
    operatorStart !== undefined &&
    "~|^$*".includes(operatorStart) &&
    scope[index + 1] === "="
  ) {
    index += 2;
  } else {
    return undefined;
  }

  index = skipScopeWhitespace(scope, index);
  const quote = scope[index];
  if (quote === '"' || quote === "'") {
    index += 1;
    while (index < scope.length && scope[index] !== quote) index += 1;
    if (scope[index] !== quote) return undefined;
    index += 1;
  } else {
    const next = consumeScopeIdentifier(scope, index);
    if (next === index) return undefined;
    index = next;
  }

  const valueEnd = index;
  index = skipScopeWhitespace(scope, index);
  if (index > valueEnd && /[IiSs]/.test(scope[index] ?? "")) {
    index += 1;
    index = skipScopeWhitespace(scope, index);
  }
  if (scope[index] !== "]") return undefined;
  return { dependency, nextIndex: index + 1 };
}

export interface ParsedScopeSelector {
  readonly dependencies: ReadonlySet<string>;
}

// Dynamic membership safety depends on target-local root selectors. v0.1
// accepts one escape-free compound selector and leaves full syntax validation
// to the browser; relational selectors require broader mutation tracking.
export function parseSupportedScopeSelector(
  scope: string,
): ParsedScopeSelector | undefined {
  if (
    scope.length === 0 ||
    scope.includes("\\") ||
    scope.includes(",") ||
    scope.includes("/*") ||
    scope.includes("*/")
  ) {
    return undefined;
  }
  const dependencies = new Set<string>();
  let index = 0;
  let components = 0;
  if (scope[index] === "*") {
    index += 1;
    components += 1;
  } else {
    const next = consumeScopeIdentifier(scope, index);
    if (next !== index) {
      index = next;
      components += 1;
    }
  }
  while (index < scope.length) {
    const character = scope[index];
    if (character === "." || character === "#") {
      const next = consumeScopeIdentifier(scope, index + 1);
      if (next === index + 1) return undefined;
      dependencies.add(character === "." ? "class" : "id");
      index = next;
      components += 1;
    } else if (character === "[") {
      const parsed = parseScopeAttribute(scope, index);
      if (parsed === undefined) return undefined;
      dependencies.add(parsed.dependency);
      index = parsed.nextIndex;
      components += 1;
    } else {
      return undefined;
    }
  }
  return components > 0 ? { dependencies } : undefined;
}
