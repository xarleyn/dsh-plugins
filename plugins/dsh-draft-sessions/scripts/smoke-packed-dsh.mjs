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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isExpectedBrowserError } from "./browser-errors.mjs";

const repo = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const testedReleases = compatibility.deepseekHarness.testedReleases;
if (!Array.isArray(testedReleases) || testedReleases.length === 0) {
  throw new Error("compatibility.json must declare testedReleases");
}
const dshVersion = process.env.DSH_VERSION ?? testedReleases.at(-1);
if (!testedReleases.includes(dshVersion)) {
  throw new Error(`DSH ${dshVersion} is not present in testedReleases`);
}
const withBrowser = process.argv.includes("--browser");
const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-draft-packed-smoke-"));
const packageDirectory = join(temporaryRoot, "package");
const toolDirectory = join(temporaryRoot, "tool");
const dshHome = join(temporaryRoot, "home");
const workspacePath = join(temporaryRoot, "workspace");
let host;
let browser;

async function pnpmEntryPoint() {
  const corepack = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (
    await stat(corepack).then(
      () => true,
      () => false,
    )
  )
    return corepack;
  const pnpmHome = process.env.PNPM_HOME;
  if (pnpmHome === undefined) return undefined;
  const tools = join(pnpmHome, ".tools", "pnpm");
  const versions = await readdir(tools).catch(() => []);
  for (const version of versions.toSorted().reverse()) {
    const candidate = join(tools, version, "bin", "pnpm.cjs");
    if (
      await stat(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return undefined;
}

const pnpmCli = await pnpmEntryPoint();

async function suppliedTarball() {
  const configured = process.env.DSH_DRAFT_TARBALL;
  if (configured === undefined) return undefined;
  const target = resolve(repo, configured);
  const details = await stat(target);
  if (details.isFile()) {
    if (!target.endsWith(".tgz"))
      throw new Error("supplied package is not a .tgz");
    return target;
  }
  if (!details.isDirectory())
    throw new Error("supplied package path is unusable");
  const tarballs = (await readdir(target)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error("supplied package directory must contain one .tgz");
  }
  return join(target, tarballs[0]);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repo,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: options.shell ?? false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code ?? signal})\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

function runPnpm(args, options = {}) {
  const command = pnpmCli === undefined ? "pnpm" : process.execPath;
  const commandArgs = pnpmCli === undefined ? args : [pnpmCli, ...args];
  return run(command, commandArgs, {
    ...options,
    env: {
      ...(options.env ?? process.env),
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
    shell: pnpmCli === undefined && process.platform === "win32",
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to reserve an E2E port");
  }
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
    `timed out waiting for ${description}${lastError === undefined ? "" : `: ${String(lastError)}`}`,
  );
}

function startHost(bin, port, log) {
  const child = spawn(
    process.execPath,
    [bin, "web", "--no-open", "--port", String(port)],
    {
      cwd: workspacePath,
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
  return child;
}

async function stopHost() {
  const child = host;
  host = undefined;
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DSH host did not stop")), 10_000),
    ),
  ]);
}

async function rpc(origin, method, payload, typert = false) {
  const rpcId = `smoke-${randomUUID()}`;
  const response = await fetch(`${origin}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId,
      method,
      payload: typert ? { args: { request: payload } } : payload,
    }),
  });
  if (!response.ok)
    throw new Error(`${method} returned HTTP ${response.status}`);
  const envelope = await response.json();
  if (envelope.rpcId !== rpcId)
    throw new Error(`${method} returned another rpcId`);
  if (!envelope.result?.ok) {
    throw new Error(
      `${method} failed: ${JSON.stringify(envelope.result?.error)}`,
    );
  }
  return envelope.result.value;
}

async function dismissOnboarding(page) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const testingNotice = page.getByRole("button", {
      name: "Continue",
      exact: true,
    });
    if (
      (await testingNotice.isVisible().catch(() => false)) &&
      (await testingNotice.isEnabled().catch(() => false))
    ) {
      await testingNotice.click();
    }
    const later = page.getByRole("button", {
      name: "Configure later",
      exact: true,
    });
    if (
      (await later.isVisible().catch(() => false)) &&
      (await later.isEnabled().catch(() => false))
    ) {
      await later.click();
    }
    if (
      !(await page
        .getByRole("dialog")
        .isVisible()
        .catch(() => false))
    ) {
      await page.waitForTimeout(500);
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(
    `onboarding dialog did not close\n${await page.locator("body").innerText()}`,
  );
}

async function openDraftSurface(page) {
  const tab = page.getByRole("tab", { name: "Drafts", exact: true });
  if (await tab.isVisible().catch(() => false)) {
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  } else {
    const trigger = page.getByRole("button", { name: /^Drafts \(\d+\)$/ });
    await trigger.waitFor({ state: "visible" });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
  }
  await page
    .getByRole("tree", { name: "Draft sessions" })
    .waitFor({ state: "visible" });
}

async function createDraft(page, origin, text) {
  const before = await rpc(origin, "draftSessions/list", {}, true);
  const existingIds = new Set(before.map((draft) => draft.id));
  const currentComposer = page
    .getByRole("textbox", {
      name: /Describe what you want to build|Message the agent/,
    })
    .last();
  await currentComposer.waitFor({ state: "visible" });
  await currentComposer.press(
    process.platform === "darwin" ? "Meta+Shift+N" : "Control+Shift+N",
  );
  await dismissOnboarding(page);
  const created = await waitFor(async () => {
    const drafts = await rpc(origin, "draftSessions/list", {}, true);
    return drafts.find((draft) => !existingIds.has(draft.id));
  }, "draft shortcut materialization");
  await page.waitForTimeout(700);
  await dismissOnboarding(page);
  await openDraftSurface(page);
  const untitled = page
    .getByRole("treeitem", { name: "Untitled draft, Draft", exact: true })
    .last();
  await untitled.waitFor({ state: "visible" });
  await untitled.click();
  await page.waitForTimeout(350);
  const composer = page.getByRole("textbox", {
    name: "Describe what you want to build",
  });
  await composer.waitFor({ state: "visible" });
  await composer.fill(text);
  const row = page.getByRole("treeitem", {
    name: `${text}, Draft`,
    exact: true,
  });
  try {
    await row.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const drafts = await rpc(origin, "draftSessions/list", {}, true);
    throw new Error(
      `draft shortcut did not create a visible row\ndrafts=${JSON.stringify(drafts)}\n${await page.locator("body").innerText()}`,
      { cause: error },
    );
  }
  return waitFor(
    async () => {
      const drafts = await rpc(origin, "draftSessions/list", {}, true);
      const current = drafts.find((draft) => draft.id === created.id);
      return current?.text === text ? current : undefined;
    },
    `autosave of ${JSON.stringify(text)}`,
  );
}

async function browserE2e(origin) {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  let duringHostOutage = false;
  let hostOutageGraceUntil = 0;
  const recordBrowserError = (message) =>
    browserErrors.push({
      message,
      duringHostOutage: duringHostOutage || Date.now() < hostOutageGraceUntil,
    });
  const formatBrowserErrors = (errors) =>
    errors.map((error) => error.message).join("\n");
  const withHostOutage = async (callback) => {
    duringHostOutage = true;
    try {
      return await callback();
    } finally {
      hostOutageGraceUntil = Date.now() + 2_000;
      duringHostOutage = false;
    }
  };
  page.on("pageerror", (error) => recordBrowserError(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") recordBrowserError(message.text());
  });
  await page.goto(origin);
  await dismissOnboarding(page);
  try {
    await page
      .getByRole("tree", { name: "Sessions" })
      .waitFor({ timeout: 30_000 });
  } catch (error) {
    await page.screenshot({ path: join(temporaryRoot, "browser-boot.png") });
    throw new Error(
      `DSH UI did not boot at ${page.url()}\n${formatBrowserErrors(browserErrors)}\n${await page.locator("body").innerText()}`,
      { cause: error },
    );
  }
  await dismissOnboarding(page);
  if (browserErrors.length > 0) {
    throw new Error(
      `browser boot errors: ${formatBrowserErrors(browserErrors)}`,
    );
  }

  const reloadText = "reload-safe packed draft";
  let reloadDraft = await createDraft(page, origin, reloadText);
  await page.reload();
  await page.getByRole("tree", { name: "Sessions" }).waitFor();
  await page.waitForTimeout(700);
  await dismissOnboarding(page);
  await openDraftSurface(page);
  await page
    .getByRole("treeitem", { name: `${reloadText}, Draft`, exact: true })
    .waitFor();
  const restored = page.getByRole("textbox", {
    name: "Describe what you want to build",
  });
  await restored.waitFor();
  if ((await restored.inputValue()) !== reloadText) {
    throw new Error("browser reload did not restore the draft text");
  }

  await rpc(
    origin,
    "draftSessions/rebind",
    {
      id: reloadDraft.id,
      expectedRevision: reloadDraft.revision,
      sessionId: "session-missing-packed-smoke",
    },
    true,
  );
  reloadDraft = await withHostOutage(async () => {
    await stopHost();
    host = startHost(dshBin, port, hostLog);
    await waitFor(async () => (await fetch(origin)).ok, "restarted DSH host");
    await page.reload();
    await page.getByRole("tree", { name: "Sessions" }).waitFor();
    await page.waitForTimeout(700);
    await dismissOnboarding(page);
    await openDraftSurface(page);
    await page
      .getByRole("treeitem", { name: `${reloadText}, Draft`, exact: true })
      .click();
    return waitFor(async () => {
      const drafts = await rpc(origin, "draftSessions/list", {}, true);
      const current = drafts.find((draft) => draft.id === reloadDraft.id);
      return current?.sessionId !== "session-missing-packed-smoke"
        ? current
        : undefined;
    }, "missing Session rebind");
  });
  if (reloadDraft.text !== reloadText)
    throw new Error("rebind changed draft text");

  const acceptedText = "accepted packed draft";
  const accepted = await createDraft(page, origin, acceptedText);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await waitFor(async () => {
    const drafts = await rpc(origin, "draftSessions/list", {}, true);
    return drafts.some((draft) => draft.id === accepted.id) ? undefined : true;
  }, "accepted Send finalization");
  if (
    await page
      .getByText(/draft autosave failed/i)
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error("accepted Send surfaced a stale autosave error");
  }

  const rejectedText = "rejected packed draft";
  const rejected = await createDraft(page, origin, rejectedText);
  const rejectedSend = page.getByRole("button", {
    name: "Send message",
    exact: true,
  });
  await withHostOutage(async () => {
    await stopHost();
    await rejectedSend.click();
    await page.getByText(/Failed to fetch|fetch failed/i).waitFor();
    const rejectedComposer = page.getByRole("textbox", {
      name: /agent|build/i,
    });
    if ((await rejectedComposer.inputValue()) !== rejectedText) {
      throw new Error("transport-rejected Send cleared the composer");
    }
    host = startHost(dshBin, port, hostLog);
    await waitFor(
      async () => (await fetch(origin)).ok,
      "DSH host after rejected Send",
    );
    await page.reload();
    await page.getByRole("tree", { name: "Sessions" }).waitFor();
    await page.waitForTimeout(700);
    await dismissOnboarding(page);
    await openDraftSurface(page);
    await page
      .getByRole("treeitem", { name: `${rejectedText}, Draft`, exact: true })
      .waitFor();
    const drafts = await rpc(origin, "draftSessions/list", {}, true);
    if (
      !drafts.some(
        (draft) => draft.id === rejected.id && draft.text === rejectedText,
      )
    ) {
      throw new Error(
        "transport-rejected Send did not preserve the durable draft",
      );
    }
  });
  const unexpectedBrowserErrors = browserErrors.filter(
    (error) => !isExpectedBrowserError(error),
  );
  if (unexpectedBrowserErrors.length > 0) {
    throw new Error(
      `browser errors: ${formatBrowserErrors(unexpectedBrowserErrors)}`,
    );
  }
}

const hostLog = [];
let dshBin;
let port;
let completed = false;
try {
  await Promise.all([
    mkdir(packageDirectory, { recursive: true }),
    mkdir(toolDirectory, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ]);
  await writeFile(
    join(toolDirectory, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(toolDirectory, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - .",
      "minimumReleaseAgeExclude:",
      '  - "@deepseek-ai/*"',
      "allowBuilds:",
      '  "@deepseek-ai/dsh-subprocess-local": true',
      '  "@google/genai": true',
      "  koffi: true",
      '  "node-pty": true',
      "  protobufjs: true",
      "",
    ].join("\n"),
  );
  let tarball = await suppliedTarball();
  if (tarball === undefined) {
    await runPnpm(["pack", "--pack-destination", packageDirectory]);
    const tarballs = (await readdir(packageDirectory)).filter((name) =>
      name.endsWith(".tgz"),
    );
    if (tarballs.length !== 1) {
      throw new Error("pnpm pack did not create one tarball");
    }
    tarball = join(packageDirectory, tarballs[0]);
  }
  await runPnpm(["add", "--ignore-scripts", `@deepseek-ai/dsh@${dshVersion}`], {
    cwd: toolDirectory,
  });
  dshBin = join(
    toolDirectory,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  const dshEnv = { ...process.env, DSH_HOME: dshHome };
  await run(
    process.execPath,
    [dshBin, "plugin", "--profile", "web", "add", tarball],
    {
      cwd: workspacePath,
      env: dshEnv,
    },
  );
  const composed = await run(
    process.execPath,
    [dshBin, "--profile", "web", "--dump-config"],
    { cwd: workspacePath, env: dshEnv },
  );
  if (!composed.stdout.includes("dsh-draft-sessions")) {
    throw new Error("packed plugin is absent from the composed DSH profile");
  }

  port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  host = startHost(dshBin, port, hostLog);
  await waitFor(async () => (await fetch(origin)).ok, "packed DSH host");
  const clientBundle = await (
    await fetch(`${origin}/plugins/dsh-draft-sessions/client.js`)
  ).text();
  if (!clientBundle.includes('id: "dsh-draft-sessions"')) {
    throw new Error("DSH did not serve the packed client factory");
  }
  if (clientBundle.includes("dsh-client-ui-workspace")) {
    throw new Error(
      "served client factory contains a workspace-browser implementation",
    );
  }
  if (!clientBundle.includes('"sidebar.footer.action"')) {
    throw new Error("served client factory lacks the stock sidebar fallback");
  }
  if (!clientBundle.includes("__dshNativeTabs")) {
    throw new Error("served client factory lacks native-tab cooperation");
  }
  await rpc(origin, "draftSessions/list", {}, true);
  await mkdir(workspacePath, { recursive: true });
  await rpc(origin, "workspace.create", { path: workspacePath });
  if (withBrowser) await browserE2e(origin);
  completed = true;
  console.log(
    `packed DSH ${dshVersion} smoke passed on ${process.platform}${withBrowser ? " with browser E2E" : ""}`,
  );
} finally {
  await browser?.close().catch(() => undefined);
  await stopHost().catch(() => undefined);
  if (completed) await rm(temporaryRoot, { recursive: true, force: true });
  else {
    console.error(hostLog.join(""));
    console.error(`smoke workspace retained at ${temporaryRoot}`);
  }
}
