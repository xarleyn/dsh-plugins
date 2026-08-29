import { readFile, writeFile } from "node:fs/promises";

const SEMVER_TAG =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const [tag, mode] = process.argv.slice(2);
if (tag === undefined || !SEMVER_TAG.test(tag)) {
  throw new Error(
    "release tag must be an exact SemVer prefixed with v, for example v0.0.1 or v0.0.1-rc.1",
  );
}
if (mode !== undefined && mode !== "--write") {
  throw new Error(`unknown option ${JSON.stringify(mode)}`);
}

const version = tag.slice(1);
const prerelease = version.split("+", 1)[0].includes("-");

if (mode === "--write") {
  const packageUrl = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(await readFile(packageUrl, "utf8"));
  manifest.version = version;
  await writeFile(packageUrl, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`tag=${tag}`);
console.log(`version=${version}`);
console.log(`prerelease=${String(prerelease)}`);
console.log(`npm_tag=${prerelease ? "next" : "latest"}`);
