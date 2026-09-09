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
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  freePort,
  requestWithAuthority,
  rpc,
  run,
  stopProcess,
  waitFor,
} from "./smoke-helpers.mjs";

const repo = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const dshVersion = compatibility.deepseekHarness.testedReleases.at(-1);
const withBrowser = process.argv.includes("--browser");
const presetScopedTool = process.platform === "win32" ? "pwsh" : "bash";
const keepFailedSmoke = process.env.DSH_QA_KEEP_SMOKE === "1";
const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-qa-packed-smoke-"));
const packageDirectory = join(temporaryRoot, "package");
const toolDirectory = join(temporaryRoot, "tool");
const dshHome = join(temporaryRoot, "home");
const workspacePath = join(temporaryRoot, "workspace");
const hostLog = [];

/**
 * LAN pass: boot a second host through the shipped deployment overlay
 * (all-interfaces bind) and speak to it with the Host header a LAN browser
 * would send. The browser-trust fence derives trusted authorities from the
 * machine's LAN IPv4 literals under a 0.0.0.0 bind, so a LAN client must
 * pass the fence, receive the effective QA configuration through the
 * plugin's describe Remote (settings RPCs are loopback-pinned), and get the
 * /qa navigation redirect.
 */
async function runLanPass({ dshBin, dshEnv, repo: repoRoot, hostLog: log }) {
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find(
      (iface) => iface?.family === "IPv4" && iface?.internal === false,
    )?.address;
  if (lanAddress === undefined) {
    console.log(
      "packed DSH QA smoke: no LAN IPv4 interface; skipped the LAN pass",
    );
    return;
  }
  const lanPort = await freePort();
  const lanAuthority = `${lanAddress}:${lanPort}`;
  const strangerAuthority = `203.0.113.9:${lanPort}`;
  const lanLog = [];
  let lanHost;
  try {
    lanHost = spawn(
      process.execPath,
      [
        dshBin,
        // The launcher's --patch must precede the first web-app flag.
        "web",
        "--patch",
        join(repoRoot, "deploy", "qa-lan.patch.yml"),
        "--no-open",
        "--port",
        String(lanPort),
      ],
      {
        cwd: workspacePath,
        env: dshEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    lanHost.stdout
      .setEncoding("utf8")
      .on("data", (chunk) => lanLog.push(chunk));
    lanHost.stderr
      .setEncoding("utf8")
      .on("data", (chunk) => lanLog.push(chunk));
    await waitFor(async () => {
      const response = await requestWithAuthority(
        lanPort,
        `127.0.0.1:${lanPort}`,
        "/",
      );
      return response.status === 200;
    }, "LAN-bound DSH host");
    const navigation = await requestWithAuthority(lanPort, lanAuthority, "/qa");
    if (
      navigation.status !== 302 ||
      !navigation.headers.location?.startsWith("/?__dsh_qa_route=%2Fqa")
    ) {
      throw new Error(
        `LAN /qa did not redirect through the QA navigation route: ${navigation.status} ${JSON.stringify(navigation.headers.location)}`,
      );
    }
    const described = await requestWithAuthority(
      lanPort,
      lanAuthority,
      "/api/qaSurface/describe",
      {
        type: "client-request",
        rpcId: `qa-smoke-${randomUUID()}`,
        method: "qaSurface/describe",
        payload: { args: {} },
      },
    );
    const describedEnvelope = JSON.parse(described.body);
    const describedConfig = describedEnvelope.result?.value;
    if (
      described.status !== 200 ||
      describedEnvelope.result?.ok !== true ||
      describedConfig?.enabled !== true ||
      describedConfig?.route?.path !== "/qa" ||
      describedConfig?.session?.agentPreset !== "minimal" ||
      describedConfig?.lockdown?.permissionPreset !== "qa-read-only"
    ) {
      throw new Error(
        `LAN describe did not return the effective QA configuration: ${described.status} ${described.body.slice(0, 400)}`,
      );
    }
    const pinned = await requestWithAuthority(
      lanPort,
      lanAuthority,
      "/api/settings.describe",
      {
        type: "client-request",
        rpcId: `qa-smoke-${randomUUID()}`,
        method: "settings.describe",
        payload: { args: {} },
      },
    );
    if (pinned.status !== 403) {
      throw new Error(
        `LAN settings RPC must stay loopback-pinned, got ${pinned.status}`,
      );
    }
    const stranger = await requestWithAuthority(
      lanPort,
      strangerAuthority,
      "/api/qaSurface/describe",
      {
        type: "client-request",
        rpcId: `qa-smoke-${randomUUID()}`,
        method: "qaSurface/describe",
        payload: { args: {} },
      },
    );
    if (stranger.status !== 403) {
      throw new Error(
        `an untrusted Host authority must not reach the plugin Remote, got ${stranger.status}`,
      );
    }
  } catch (error) {
    log.push(...lanLog);
    throw error;
  } finally {
    await stopProcess(lanHost);
  }
}

/** Browser E2E pass over the loopback host with a locked-down QA config. */
async function runBrowserPass({ origin, presetScopedTool: scopedTool }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 375, height: 720 },
    });
    const incompatibleSession = await rpc(origin, "session.create", {
      agentPreset: "standard",
    });
    await page.addInitScript(
      ({ key, sessionId }) => globalThis.localStorage.setItem(key, sessionId),
      {
        key: "dsh-qa-surface.session:v1:/qa:session",
        sessionId: incompatibleSession.sessionId,
      },
    );
    const errors = [];
    const apiRequests = [];
    const policyResponses = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiRequests.push(request.url());
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/qaSurface/secureSession")) {
        void response
          .text()
          .then((body) => policyResponses.push(`${response.status()}: ${body}`))
          .catch((error) =>
            policyResponses.push(`read failed: ${String(error)}`),
          );
      }
    });
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
    // The header shows no branding fallback anymore; the empty chat is
    // identified by its welcome heading instead.
    await page
      .getByRole("heading", { name: "Чем могу помочь?", exact: true })
      .waitFor();
    await page.getByRole("textbox", { name: "Задать вопрос" }).waitFor();
    const prompt = page.getByRole("textbox", { name: "Задать вопрос" });
    const send = page.getByRole("button", { name: "Отправить", exact: true });
    await send.waitFor();
    try {
      await waitFor(
        () => prompt.isEnabled(),
        "locked QA policy attestation",
        15_000,
      );
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const alerts = await page.getByRole("alert").allTextContents();
      const surfaceText = await page.locator("main.dsh-qa-surface").innerText();
      const phase = await page
        .locator("main.dsh-qa-surface")
        .getAttribute("data-phase");
      const persistedSession = await page.evaluate(() =>
        globalThis.localStorage.getItem(
          "dsh-qa-surface.session:v1:/qa:session",
        ),
      );
      const hostSessions = await rpc(origin, "session.list", {});
      throw new Error(
        `locked QA policy did not attest; phase=${phase} session=${JSON.stringify(persistedSession)} alerts=${JSON.stringify(alerts)} surface=${JSON.stringify(surfaceText)} hostSessions=${hostSessions.items.length} policyResponses=${JSON.stringify(policyResponses)} apiRequests=${JSON.stringify(apiRequests)} browserErrors=${JSON.stringify(errors)}`,
        { cause: error },
      );
    }
    if (await page.getByRole("button", { name: "Новый чат" }).count()) {
      throw new Error("locked QA surface exposed session reset");
    }
    await waitFor(
      () =>
        page.evaluate(() =>
          globalThis.localStorage.getItem(
            "dsh-qa-surface.session:v1:/qa:session",
          ),
        ),
      "QA session persistence",
    );
    const sessions = await rpc(origin, "session.list", {});
    const persistedSession = await page.evaluate(() =>
      globalThis.localStorage.getItem("dsh-qa-surface.session:v1:/qa:session"),
    );
    if (
      sessions.items.length !== 2 ||
      persistedSession === incompatibleSession.sessionId
    ) {
      throw new Error(
        `QA route did not replace its incompatible persisted Session: sessions=${sessions.items.length} persisted=${JSON.stringify(persistedSession)} incompatible=${JSON.stringify(incompatibleSession.sessionId)}`,
      );
    }
    const repeatedProof = await rpc(origin, "qaSurface/secureSession", {
      args: { sessionId: persistedSession },
    });
    if (
      repeatedProof.sessionId !== persistedSession ||
      JSON.stringify(repeatedProof.toolAllowList) !==
        JSON.stringify([scopedTool])
    ) {
      throw new Error(
        `repeat policy attestation did not preserve preset-scoped tools: ${JSON.stringify(repeatedProof)}`,
      );
    }
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
  } finally {
    await browser.close().catch(() => undefined);
  }
}

let completed = false;
let host;
try {
  await Promise.all([
    mkdir(packageDirectory, { recursive: true }),
    mkdir(toolDirectory, { recursive: true }),
    mkdir(dshHome, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ]);
  await writeFile(join(toolDirectory, "package.json"), '{"private":true}\n');
  await writeFile(
    join(toolDirectory, "pnpm-workspace.yaml"),
    'packages:\n  - .\nminimumReleaseAgeExclude:\n  - "@deepseek-ai/*"\nallowBuilds:\n  "@deepseek-ai/dsh-subprocess-local": true\n  "@google/genai": true\n  koffi: true\n  "node-pty": true\n  protobufjs: true\n',
  );
  await run("pnpm", ["pack", "--pack-destination", packageDirectory], {
    cwd: repo,
  });
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
  await writeFile(
    join(dshHome, "profiles", "web", "cordis.patch.yml"),
    `- id: permission
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
      qa-read-only:
        sandbox: read-only
        approval: never
        name: QA Read Only
        description: No filesystem mutations and no permission escalation.
- id: dsh-qa-surface
  config:
    enabled: true
    route:
      path: /qa
      matchChildren: true
    session:
      agentPreset: minimal
    ui:
      showReset: false
    lockdown:
      enabled: true
      sandboxMode: read-only
      approvalPolicy: never
      permissionPreset: qa-read-only
      allowSessionReset: false
      toolPolicy:
        mode: allow-list
        # The minimal preset contributes its shell through an ancestor scope. Keeping
        # this non-empty catches a regression where the first attestation
        # accidentally restricts the session to global-only tools and makes
        # every later attestation fail with unknown-tools.
        allow:
          - ${presetScopedTool}
`,
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

  await runLanPass({ dshBin, dshEnv, repo, hostLog });
  if (withBrowser) {
    await runBrowserPass({ origin, presetScopedTool });
  }
  completed = true;
  console.log(
    `packed DSH ${dshVersion} QA smoke passed${withBrowser ? " with browser E2E" : ""}`,
  );
} finally {
  await stopProcess(host);
  if (!completed) console.error(hostLog.join(""));
  if (!completed && keepFailedSmoke) {
    console.error(`kept failed smoke workspace: ${temporaryRoot}`);
  } else {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
