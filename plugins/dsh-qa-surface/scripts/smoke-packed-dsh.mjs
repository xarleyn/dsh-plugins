import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const dshVersion = compatibility.deepseekHarness.testedReleases.at(-1);
const withBrowser = process.argv.includes("--browser");
const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-qa-packed-smoke-"));
const packageDirectory = join(temporaryRoot, "package");
const toolDirectory = join(temporaryRoot, "tool");
const dshHome = join(temporaryRoot, "home");
const workspacePath = join(temporaryRoot, "workspace");
let host;
let browser;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repo,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && command === "pnpm",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code ?? signal})\n${stdout}\n${stderr}`,
          ),
        );
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null)
    throw new Error("failed to reserve a port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}

async function waitFor(check, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `timed out waiting for ${description}: ${String(lastError ?? "no result")}`,
  );
}

async function rpc(origin, method, payload) {
  const rpcId = `qa-smoke-${randomUUID()}`;
  const response = await fetch(`${origin}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
  });
  const envelope = await response.json();
  if (!response.ok || !envelope.result?.ok) {
    throw new Error(
      `${method} failed: ${JSON.stringify(envelope.result?.error)}`,
    );
  }
  return envelope.result.value;
}

function stopHost() {
  return new Promise((resolve) => {
    if (host === undefined || host.exitCode !== null) return resolve();
    host.once("exit", resolve);
    host.kill("SIGTERM");
  });
}

let completed = false;
const hostLog = [];
try {
  await Promise.all([
    mkdir(packageDirectory, { recursive: true }),
    mkdir(toolDirectory, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ]);
  await writeFile(join(toolDirectory, "package.json"), '{"private":true}\n');
  await writeFile(
    join(toolDirectory, "pnpm-workspace.yaml"),
    'packages:\n  - .\nminimumReleaseAgeExclude:\n  - "@deepseek-ai/*"\nallowBuilds:\n  "@deepseek-ai/dsh-subprocess-local": true\n  "@google/genai": true\n  koffi: true\n  "node-pty": true\n  protobufjs: true\n',
  );
  await run("pnpm", ["pack", "--pack-destination", packageDirectory]);
  const tarballs = (await readdir(packageDirectory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (tarballs.length !== 1)
    throw new Error("pack did not produce exactly one tarball");
  await run(
    "pnpm",
    ["add", "--ignore-scripts", `@deepseek-ai/dsh@${dshVersion}`],
    {
      cwd: toolDirectory,
    },
  );
  const dshBin = join(
    toolDirectory,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  if (!(await stat(dshBin)).isFile()) throw new Error("DSH binary is missing");
  const dshEnv = { ...process.env, DSH_HOME: dshHome };
  await run(
    process.execPath,
    [
      dshBin,
      "plugin",
      "--profile",
      "web",
      "add",
      join(packageDirectory, tarballs[0]),
    ],
    {
      cwd: workspacePath,
      env: dshEnv,
    },
  );
  const composed = await run(
    process.execPath,
    [dshBin, "--profile", "web", "--dump-config"],
    {
      cwd: workspacePath,
      env: dshEnv,
    },
  );
  if (!composed.stdout.includes("dsh-qa-surface"))
    throw new Error("plugin is absent from web profile");

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  host = spawn(
    process.execPath,
    [dshBin, "web", "--no-open", "--port", String(port)],
    {
      cwd: workspacePath,
      env: dshEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  host.stdout.setEncoding("utf8").on("data", (chunk) => hostLog.push(chunk));
  host.stderr.setEncoding("utf8").on("data", (chunk) => hostLog.push(chunk));
  await waitFor(async () => (await fetch(origin)).ok, "DSH host");
  const qaDocument = await fetch(`${origin}/qa`, {
    headers: { accept: "text/html" },
  });
  const qaHtml = await qaDocument.text();
  if (
    !qaDocument.ok ||
    !qaDocument.headers.get("content-type")?.includes("text/html") ||
    !/<(?:!doctype\s+html|html[\s>])/iu.test(qaHtml)
  ) {
    throw new Error(
      `/qa did not return the normal DSH SPA document: status=${qaDocument.status} content-type=${qaDocument.headers.get("content-type")} body=${JSON.stringify(qaHtml.slice(0, 300))}`,
    );
  }
  const bundle = await (
    await fetch(`${origin}/plugins/@yadsh/dsh-qa-surface/client.js`)
  ).text();
  if (!bundle.includes('id: "@yadsh/dsh-qa-surface"')) {
    throw new Error(
      "scoped client bundle was not served with its full module id",
    );
  }

  if (withBrowser) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 375, height: 720 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${origin}/qa`);
    await page.locator("main.dsh-qa-surface").waitFor({ timeout: 30_000 });
    const qaUrl = new URL(page.url());
    if (qaUrl.pathname !== "/qa" || qaUrl.search !== "") {
      throw new Error(`QA navigation was not restored: ${qaUrl.href}`);
    }
    const viewport = await page
      .locator("main.dsh-qa-surface")
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          viewportWidth: globalThis.innerWidth,
          viewportHeight: globalThis.innerHeight,
          background: globalThis.getComputedStyle(node).backgroundColor,
        };
      });
    if (
      viewport.x !== 0 ||
      viewport.y !== 0 ||
      viewport.width !== viewport.viewportWidth ||
      viewport.height !== viewport.viewportHeight ||
      viewport.background === "rgba(0, 0, 0, 0)"
    ) {
      throw new Error(
        `QA overlay does not cover the viewport: ${JSON.stringify(viewport)}`,
      );
    }
    await page
      .getByRole("heading", { name: "Assistant", exact: true })
      .waitFor();
    await page.getByRole("textbox", { name: "Ask a question" }).waitFor();
    await page.getByRole("button", { name: "Send", exact: true }).waitFor();
    await waitFor(
      () =>
        page.evaluate(() =>
          globalThis.localStorage.getItem("dsh-qa-surface:v1:/qa:session"),
        ),
      "QA session persistence",
    );
    const sessions = await rpc(origin, "session.list", {});
    if (sessions.items.length === 0)
      throw new Error("QA route did not create a DSH Session");
    await page.goto(origin);
    await page.locator("main.dsh-qa-surface").waitFor({ state: "detached" });
    if (
      await page.evaluate(() => globalThis.document.body.dataset.dshQaSurface)
    ) {
      throw new Error("leaving /qa did not restore the document marker");
    }
    await page.goto(`${origin}/qa/child`);
    await page.locator("main.dsh-qa-surface").waitFor();
    if (new URL(page.url()).pathname !== "/qa/child") {
      throw new Error(`child QA navigation was not restored: ${page.url()}`);
    }
    if (errors.length > 0)
      throw new Error(`browser errors:\n${errors.join("\n")}`);
  }
  completed = true;
  console.log(
    `packed DSH ${dshVersion} QA smoke passed${withBrowser ? " with browser E2E" : ""}`,
  );
} finally {
  await browser?.close().catch(() => undefined);
  await stopHost().catch(() => undefined);
  if (!completed) console.error(hostLog.join(""));
  await rm(temporaryRoot, { recursive: true, force: true });
}
