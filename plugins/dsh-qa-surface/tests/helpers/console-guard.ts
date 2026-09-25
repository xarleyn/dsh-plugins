import { afterEach, beforeEach, expect } from "vitest";

/**
 * Console output a test provokes on purpose.
 *
 * Every entry is a diagnostic the plugin writes while the test asserts the
 * refusal that caused it, so seeing it is the point of the case. Anything
 * outside this list — a React warning, an uncaught error, a stack nobody
 * expected — fails the test instead of scrolling past green.
 */
const EXPECTED_CONSOLE: readonly RegExp[] = [
  // Attestation refusals: the operator-facing reason line, and the wire
  // failure that carries no reason code to name.
  /^dsh-qa-surface: policy attestation failed \(reason: [a-z-]+[).]/u,
  /^dsh-qa-surface: policy attestation request failed/u,
  // A session operation that ended in the error phase logs what threw.
  /^dsh-qa-surface: session operation failed/u,
  // The account controller's refusals: the gate probe, and an action the
  // Host turned down.
  /^dsh-qa-surface: accounts whoami failed/u,
  /^dsh-qa-surface: account operation failed/u,
  // An attachment the Host refused to stage.
  /^dsh-qa-surface: file upload refused/u,
];

interface Recorded {
  readonly test: string | null;
  readonly line: string;
}

const original = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};
const recorded: Recorded[] = [];

function currentTest(): string | null {
  return expect.getState().currentTestName ?? null;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
}

function capture(level: "error" | "warn") {
  return (...args: unknown[]): void => {
    const message = args.map(describe).join(" ");
    if (!EXPECTED_CONSOLE.some((expected) => expected.test(message))) {
      recorded.push({ test: currentTest(), line: `${level}: ${message}` });
    }
    // Keep printing: a suite that fails on noise must still show it.
    original[level](...args);
  };
}

beforeEach(() => {
  recorded.length = 0;
  console.error = capture("error");
  console.warn = capture("warn");
});

afterEach(() => {
  console.error = original.error;
  console.warn = original.warn;
  // Only the noise this test produced is this test's fault: an update that
  // lands after it is attributed to whoever is running next, and failing that
  // test would report the wrong culprit.
  const test = currentTest();
  const unexpected = recorded
    .filter((entry) => entry.test === test)
    .map((entry) => entry.line);
  expect(
    unexpected,
    `unexpected console output${test === null ? "" : ` in "${test}"`}:\n${unexpected.join("\n")}`,
  ).toEqual([]);
});
