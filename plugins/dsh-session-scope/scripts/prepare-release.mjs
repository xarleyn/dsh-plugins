import { readFile, writeFile } from "node:fs/promises";

const SEMVER_TAG =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const [tag, mode] = process.argv.slice(2);
if (tag === undefined || !SEMVER_TAG.test(tag)) {
  throw new Error("release tag must be exact SemVer prefixed with v, for example v0.5.0");
}
if (mode !== undefined && mode !== "--write") {
  throw new Error(`unknown option ${JSON.stringify(mode)}`);
}

const version = tag.slice(1);
const packageUrl = new URL("../package.json", import.meta.url);
const lockUrl = new URL("../package-lock.json", import.meta.url);
const manifest = JSON.parse(await readFile(packageUrl, "utf8"));
const lock = JSON.parse(await readFile(lockUrl, "utf8"));

if (mode === "--write") {
  manifest.version = version;
  lock.version = version;
  if (lock.packages?.[""] !== undefined) lock.packages[""].version = version;
  await Promise.all([
    writeFile(packageUrl, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`),
  ]);
} else {
  const versions = [manifest.version, lock.version, lock.packages?.[""]?.version];
  if (versions.some((candidate) => candidate !== version)) {
    throw new Error(`tag ${tag}, package.json and package-lock.json versions must match`);
  }
}

const prerelease = version.split("+", 1)[0].includes("-");
console.log(`tag=${tag}`);
console.log(`version=${version}`);
console.log(`prerelease=${String(prerelease)}`);
console.log(`npm_tag=${prerelease ? "next" : "latest"}`);
