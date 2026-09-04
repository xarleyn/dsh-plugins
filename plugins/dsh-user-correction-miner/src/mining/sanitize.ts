import { truncateText } from "./text-budget.js";

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gu,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/giu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/giu,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), text);
}

export function boundText(text: string, maxChars: number): string {
  return truncateText(text, maxChars, "code-points");
}
