import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const formatArg = process.argv.find((arg) => arg.startsWith("--format="));
const format = formatArg?.slice("--format=".length) ?? "json";

function workspacePackages() {
  const packages = [];

  for (const group of ["plugins", "packages"]) {
    if (!existsSync(group)) continue;

    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.posix.join(group, entry.name);
      const manifestPath = path.join(directory, "package.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private === true) continue;

      const tarball = `${manifest.name
        .replace(/^@/, "")
        .replaceAll("/", "-")}-${manifest.version}.tgz`;

      packages.push({
        name: manifest.name,
        version: manifest.version,
        directory,
        tarball,
      });
    }
  }

  return packages;
}

function selectedNames() {
  const projectsJson = process.env.DSH_PROJECTS_JSON;
  if (projectsJson) {
    const projects = JSON.parse(projectsJson);
    if (!Array.isArray(projects)) {
      throw new Error("DSH_PROJECTS_JSON must contain a JSON array.");
    }
    return new Set(projects);
  }

  if (args.has("--changed") || args.has("--release-commit")) {
    const range = args.has("--release-commit") ? ["HEAD^", "HEAD"] : ["HEAD"];
    const output = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "--diff-filter=AM",
        ...range,
        "--",
        "plugins/*/package.json",
        "packages/*/package.json",
      ],
      { encoding: "utf8" },
    );

    return new Set(
      output
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((file) => path.posix.dirname(file.replaceAll("\\", "/"))),
    );
  }

  return null;
}

const selected = selectedNames();
const packages = workspacePackages().filter((item) => {
  if (!selected) return true;
  return selected.has(item.name) || selected.has(item.directory);
});

if (args.has("--require") && packages.length === 0) {
  throw new Error("No publishable packages were selected.");
}

switch (format) {
  case "dirs":
    process.stdout.write(packages.map((item) => item.directory).join(" "));
    break;
  case "names":
    process.stdout.write(packages.map((item) => item.name).join(","));
    break;
  case "tsv":
    process.stdout.write(
      packages
        .map(
          (item) =>
            `${item.name}\t${item.version}\t${item.directory}\t${item.tarball}`,
        )
        .join("\n") + (packages.length > 0 ? "\n" : ""),
    );
    break;
  case "github-output":
    process.stdout.write(
      [
        `count=${packages.length}`,
        `projects=${packages.map((item) => item.name).join(",")}`,
        `directories=${packages.map((item) => item.directory).join(" ")}`,
      ].join("\n") + "\n",
    );
    break;
  case "json":
    process.stdout.write(JSON.stringify(packages));
    break;
  default:
    throw new Error(`Unsupported format: ${format}`);
}
