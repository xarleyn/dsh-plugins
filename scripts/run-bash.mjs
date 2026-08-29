import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [script, ...args] = process.argv.slice(2);

if (!script) {
  console.error("Usage: node scripts/run-bash.mjs <script> [...args]");
  process.exit(2);
}

const windowsCandidates = [
  `${process.env.ProgramFiles ?? "C:\\Program Files"}\\Git\\bin\\bash.exe`,
  `${process.env.ProgramFiles ?? "C:\\Program Files"}\\Git\\usr\\bin\\bash.exe`,
];

const bash =
  process.platform === "win32"
    ? windowsCandidates.find(existsSync)
    : "bash";

if (!bash) {
  console.error("Git Bash is required on Windows to run repository shell gates.");
  process.exit(1);
}

const result = spawnSync(bash, [script, ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
