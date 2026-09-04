import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FILES = [
  "compatibility.json",
  "cordis.patch.yml",
  "LICENSE",
  "README.md",
];

const STANDARD_TYPES_LAYOUTS = new Set([
  "./lib/index.d.ts",
  "./lib/types/index.d.ts",
]);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function validatePublishablePlugin(directory) {
  const errors = [];
  const manifestPath = path.join(directory, "package.json");
  const manifest = readJson(manifestPath);
  if (manifest.private === true) return errors;

  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(directory, file))) {
      errors.push(`${file} is missing`);
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes(file)) {
      errors.push(`${file} is missing from package.json files`);
    }
  }

  if (manifest.exports?.["./package.json"] !== "./package.json") {
    errors.push('exports["./package.json"] must equal "./package.json"');
  }

  const rootExport = manifest.exports?.["."];
  const exportedTypes =
    typeof rootExport === "object" && rootExport !== null
      ? rootExport.types
      : undefined;
  if (manifest.types !== exportedTypes) {
    errors.push("package types must match exports[\".\"].types");
  }

  if (!STANDARD_TYPES_LAYOUTS.has(manifest.types)) {
    errors.push(
      `unsupported declaration layout ${JSON.stringify(manifest.types)}; ` +
        "use ./lib/index.d.ts or ./lib/types/index.d.ts",
    );
  }

  const compatibilityPath = path.join(directory, "compatibility.json");
  if (existsSync(compatibilityPath)) {
    const compatibility = readJson(compatibilityPath);
    const harness = compatibility.deepseekHarness;
    if (typeof harness?.range !== "string" || harness.range.length === 0) {
      errors.push("compatibility.json must declare deepseekHarness.range");
    }
    if (
      !Array.isArray(harness?.testedReleases) ||
      harness.testedReleases.length === 0 ||
      harness.testedReleases.some(
        (release) => typeof release !== "string" || release.length === 0,
      )
    ) {
      errors.push(
        "compatibility.json must declare at least one tested DSH release",
      );
    }
    if (compatibility.node !== manifest.engines?.node) {
      errors.push(
        "compatibility.json node must exactly match package.json engines.node",
      );
    }
  }

  return errors;
}

export function verifyPublishablePlugins(repoRoot = process.cwd()) {
  const pluginsRoot = path.join(repoRoot, "plugins");
  const failures = [];
  let verified = 0;

  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(pluginsRoot, entry.name);
    if (!existsSync(path.join(directory, "package.json"))) continue;
    const manifest = readJson(path.join(directory, "package.json"));
    if (manifest.private === true) continue;
    verified += 1;
    for (const error of validatePublishablePlugin(directory)) {
      failures.push(`${manifest.name}: ${error}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`publishable plugin hygiene failed:\n- ${failures.join("\n- ")}`);
  }
  return verified;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const verified = verifyPublishablePlugins();
  process.stdout.write(`package hygiene: verified ${verified} publishable plugins\n`);
}
