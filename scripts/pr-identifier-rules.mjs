/** Added public text only; private names stay in an operator-supplied file. */
const syntheticTickets = new Set(["PROJ-123", "PROJ-456"]);
const technicalKey =
  /^(?:RFC|ISO|IEEE|AES|SHA|UTF|TLS|RSA|CRC|PDF|ADR|NODE|PHASE|STEP)-\d+$/u;
const ticket = /\b[A-Z]{3,10}-[0-9]+\b/gu;
const internalHost =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:corp|internal|intranet|lan|local)\b/giu;
const privateAddress =
  /\b(?:10(?:\.[0-9]{1,3}){3}|192\.168(?:\.[0-9]{1,3}){2}|172\.(?:1[6-9]|2[0-9]|3[01])(?:\.[0-9]{1,3}){2}):[0-9]{1,5}\b/gu;

export function identifierFindings(text, { names = [] } = {}) {
  const findings = [];
  for (const match of text.matchAll(ticket)) {
    if (syntheticTickets.has(match[0]) || technicalKey.test(match[0])) continue;
    // Release names such as DSH-0.1.7 are not tracker keys.
    if (/^\.\d/u.test(text.slice(match.index + match[0].length))) continue;
    findings.push({
      rule: "tracker-key",
      message: "use a synthetic ticket such as PROJ-123 or PROJ-456",
    });
  }
  for (const match of text.matchAll(internalHost)) {
    const host = match[0].toLowerCase();
    if (host.split(".").includes("example")) continue;
    // Docker's documented host gateway alias is a platform name.
    if (host === "host.docker.internal") continue;
    // This exact override filename is not a network address. Keep URL uses
    // and every other .local name subject to the host rule.
    if (
      host === "doc-impact.local" &&
      text.slice(match.index - 5, match.index) === ".dsh/" &&
      /^\.yml(?:[`'"\s)]|$)/u.test(text.slice(match.index + match[0].length))
    )
      continue;
    if (/^\.example\b/u.test(text.slice(match.index + match[0].length)))
      continue;
    findings.push({
      rule: "internal-host",
      message: "use a documentation host such as jira.example.corp",
    });
  }
  for (const match of text.matchAll(privateAddress)) {
    const [host, port] = match[0].split(":");
    if (
      host.split(".").some((octet) => Number(octet) > 255) ||
      Number(port) > 65535
    )
      continue;
    findings.push({
      rule: "internal-address",
      message: "use an RFC 5737 documentation address",
    });
  }
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(
      `(?<![\\p{L}\\d_])${escaped}(?![\\p{L}\\d_])`,
      "iu",
    );
    if (pattern.test(text))
      findings.push({
        rule: "person-name",
        message:
          "replace the private name or login with a synthetic placeholder",
      });
  }
  return findings;
}
