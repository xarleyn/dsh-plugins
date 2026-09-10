/**
 * Secret and credential-format detection (design SPEC §6).
 *
 * Patterns are deliberately format-specific (real key prefixes, JWT shape,
 * PEM headers) to keep the false-positive rate survivable in a developer
 * tool: reading an `.env` file through a tool result is normal; the guard
 * only escalates when policy asks it to (channel policy in the guards).
 */

import type { SafetyCategory, SafetyDecision } from "../types.js";
import type { InjectionRule } from "./injection.js";

/** Secret rules reuse the InjectionRule shape with `secret_leak` category. */
export const SECRET_RULES: readonly InjectionRule[] = [
  {
    id: "secret.private_key_block",
    category: "secret_leak",
    severity: "block",
    confidence: 0.95,
    source: "-----BEGIN\\s+(?:(?:RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED)\\s+)?PRIVATE\\s+KEY(?:\\s+BLOCK)?-----",
  },
  {
    id: "secret.anthropic_key",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.9,
    source: "\\bsk-ant-[A-Za-z0-9_-]{20,}\\b",
  },
  {
    id: "secret.openai_key",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.85,
    source: "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",
  },
  {
    id: "secret.github_token",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.9,
    source: "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\\b|\\bgithub_pat_[A-Za-z0-9_]{20,}\\b",
  },
  {
    id: "secret.aws_access_key",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.85,
    source: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",
  },
  {
    id: "secret.stripe_key",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.9,
    source: "\\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{10,}\\b",
  },
  {
    id: "secret.slack_token",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.9,
    source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b",
  },
  {
    id: "secret.google_api_key",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.85,
    source: "\\bAIza[0-9A-Za-z_-]{35}\\b",
  },
  {
    id: "secret.jwt",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.7,
    source: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{5,}\\b",
  },
  {
    id: "secret.telegram_bot_token",
    category: "secret_leak",
    severity: "warn",
    confidence: 0.8,
    source: "\\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\\b",
  },
  {
    id: "secret.key_value_assignment",
    category: "credential_exfiltration",
    severity: "warn",
    confidence: 0.5,
    source: "\\b(?:api[_-]?key|apikey|secret|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|авт[оa]?р[иi]?зац[иi][яi]|пароль|токен)\\b\\s*[:=]\\s*[\"'][A-Za-z0-9+/=_.-]{16,}[\"']",
  },
] as const;

/**
 * Shannon entropy in bits per character, used by the generic high-entropy
 * token heuristic.
 */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

const HIGH_ENTROPY_TOKEN = /\b[A-Za-z0-9+/=_-]{24,}\b/g;

/** Finding shape produced by the generic high-entropy heuristic. */
export interface EntropyFinding {
  readonly ruleId: "secret.high_entropy_token";
  readonly category: SafetyCategory;
  readonly severity: Extract<SafetyDecision, "warn" | "block">;
  readonly confidence: number;
  readonly spanLength: number;
}

/**
 * Generic secret-like token heuristic: long mixed-class runs with high
 * entropy that no specific format rule matched. Low confidence on purpose —
 * build artifacts and minified code also look like this.
 */
export function findHighEntropyTokens(
  text: string,
  options?: { minLength?: number; minEntropy?: number; maxFindings?: number },
): EntropyFinding[] {
  const minLength = options?.minLength ?? 24;
  const minEntropy = options?.minEntropy ?? 3.6;
  const maxFindings = options?.maxFindings ?? 8;
  const findings: EntropyFinding[] = [];
  for (const match of text.matchAll(HIGH_ENTROPY_TOKEN)) {
    if (findings.length >= maxFindings) break;
    const token = match[0];
    if (token.length < minLength) continue;
    const hasLetters = /[a-z]/.test(token) && /[A-Z]/.test(token);
    const hasDigits = /[0-9]/.test(token);
    if (!hasDigits || (!hasLetters && !/[_+/=-]/.test(token.slice(4)))) continue;
    const entropy = shannonEntropy(token);
    if (entropy < minEntropy) continue;
    findings.push({
      ruleId: "secret.high_entropy_token",
      category: "secret_leak",
      severity: "warn",
      confidence: Math.min(0.5, 0.25 + (entropy - minEntropy) * 0.1),
      spanLength: token.length,
    });
  }
  return findings;
}
