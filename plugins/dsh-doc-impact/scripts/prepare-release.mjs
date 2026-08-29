import { readFile, writeFile } from "node:fs/promises";

const SEMVER_TAG =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const [tag, mode] = process.argv.slice(2);
if (tag === undefined || !SEMVER_TAG.test(tag)) {
  throw new Error(
    "release tag must be an exact SemVer prefixed with v, for example v0.1.0 or v0.1.0-rc.1",
  );
}
if (mode !== undefined && mode !== "--write" && mode !== "--check") {
  throw new Error(`unknown option ${JSON.stringify(mode)}`);
}

const version = tag.slice(1);
const prerelease = version.split("+", 1)[0].includes("-");

const versionFiles = [
  new URL("../package.json", import.meta.url),
  new URL("../package-lock.json", import.meta.url),
];

for (const fileUrl of versionFiles) {
  const manifest = JSON.parse(await readFile(fileUrl, "utf8"));
  const relative = fileUrl.pathname.split("/").at(-1);

  if (mode === "--check" && manifest.version !== version) {
    throw new Error(`${relative} version ${JSON.stringify(manifest.version)} does not match tag ${tag}`);
  }
  if (
    mode === "--check" &&
    relative === "package-lock.json" &&
    manifest.packages?.[""]?.version !== version
  ) {
    throw new Error(
      `package-lock.json root version ${JSON.stringify(manifest.packages?.[""]?.version)} does not match tag ${tag}`,
    );
  }

  if (mode === "--write") {
    manifest.version = version;
    if (relative === "package-lock.json" && manifest.packages?.[""] !== undefined) {
      manifest.packages[""].version = version;
    }
    await writeFile(fileUrl, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

console.log(`tag=${tag}`);
console.log(`version=${version}`);
console.log(`prerelease=${String(prerelease)}`);
console.log(`npm_tag=${prerelease ? "next" : "latest"}`);
