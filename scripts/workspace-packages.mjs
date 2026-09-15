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
  case "github-matrix": {
    if (!selected) {
      throw new Error(
        "DSH_PROJECTS_JSON is required for the github-matrix format.",
      );
    }

    const publishableByName = new Map(
      workspacePackages().map((item) => [item.name, item]),
    );
    const include = [...selected].sort().map((project) => {
      const publishablePackage = publishableByName.get(project);
      return publishablePackage
        ? {
            project,
            publishable: true,
            directory: publishablePackage.directory,
          }
        : { project, publishable: false, directory: "" };
    });

    process.stdout.write(
      [`count=${include.length}`, `matrix=${JSON.stringify({ include })}`].join(
        "\n",
      ) + "\n",
    );
    break;
  }
  // The release workflow fans out one job per released package and verifies
  // every other project in a sweep that runs beside it, so the two lists are
  // published together: the matrix below has to name the projects that sweep
  // must leave alone, or they would be verified twice on different runners.
  case "release-matrix": {
    const allProjectsJson = process.env.DSH_ALL_PROJECTS_JSON;
    if (!allProjectsJson) {
      throw new Error(
        "DSH_ALL_PROJECTS_JSON is required for the release-matrix format.",
      );
    }
    const allProjects = JSON.parse(allProjectsJson);
    if (!Array.isArray(allProjects)) {
      throw new Error("DSH_ALL_PROJECTS_JSON must contain a JSON array.");
    }

    // Sorted, because the selection arrives as directory names in readdir
    // order and a matrix that reorders between runs is hard to read.
    const include = [...packages]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((item) => ({
        project: item.name,
        directory: item.directory,
        // Artifact names reject `/`, so the scope and the group directory are
        // dropped: the directory basename is unique among workspace packages.
        slug: path.posix.basename(item.directory),
      }));
    const released = new Set(include.map((item) => item.project));

    process.stdout.write(
      [
        `count=${include.length}`,
        `projects=${include.map((item) => item.project).join(",")}`,
        `gates_projects=${allProjects
          .filter((name) => !released.has(name))
          .join(",")}`,
        `matrix=${JSON.stringify({ include })}`,
      ].join("\n") + "\n",
    );
    break;
  }
  case "json":
    process.stdout.write(JSON.stringify(packages));
    break;
  default:
    throw new Error(`Unsupported format: ${format}`);
}
