import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  authenticateBrowser,
  freePort,
  launchToken,
  requestWithAuthority,
  rpc,
  stopProcess,
  waitFor,
} from "./smoke-helpers.mjs";

export async function runLanPass({
  dshBin,
  dshEnv,
  workspacePath,
  profilePath,
  hostLog,
}) {
  const address = Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .find(({ family, internal }) => family === "IPv4" && !internal)?.address;
  if (!address) {
    console.log(
      "packed DSH QA smoke: no LAN IPv4 interface; skipped the LAN pass",
    );
    return;
  }
  const port = await freePort(address);
  const authority = `${address}:${port}`;
  const origin = `http://${authority}`;
  const patch = join(
    profilePath,
    "node_modules",
    "@yadsh",
    "dsh-qa-surface",
    "deploy",
    "qa-lan.patch.yml",
  );
  const log = [];
  const host = spawn(
    process.execPath,
    [
      dshBin,
      "web",
      "--patch",
      patch,
      "--no-open",
      "--host",
      address,
      "--port",
      String(port),
    ],
    {
      cwd: workspacePath,
      env: dshEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  host.stdout.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
  host.stderr.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
  try {
    const token = await waitFor(() => launchToken(log), "LAN launch token");
    const cookie = await authenticateBrowser(port, authority, token, address);
    const headers = { cookie };
    const navigation = await fetch(`${origin}/qa`, {
      headers,
      redirect: "manual",
    });
    if (
      navigation.status !== 302 ||
      !navigation.headers.get("location")?.startsWith("/?__dsh_qa_route=%2Fqa")
    ) {
      throw new Error(
        `LAN /qa did not return the QA navigation redirect (HTTP ${navigation.status})`,
      );
    }
    const config = await rpc(
      origin,
      "qaSurface/describe",
      { args: {} },
      cookie,
    );
    if (
      config?.enabled !== true ||
      config.route?.path !== "/qa" ||
      config.session?.agentPreset !== "minimal" ||
      config.lockdown?.permissionPreset !== "qa-read-only"
    ) {
      throw new Error(
        "LAN describe did not return the configured route, preset and lockdown",
      );
    }
    async function expectDenied(method, requestAuthority) {
      const response = await requestWithAuthority(
        port,
        requestAuthority,
        `/api/${method}`,
        {
          type: "client-request",
          rpcId: randomUUID(),
          method,
          payload: { args: {} },
        },
        headers,
        address,
      );
      if (response.status !== 403 && response.status !== 404) {
        throw new Error(
          `LAN ${method} expected access refusal (HTTP ${response.status})`,
        );
      }
    }
    await expectDenied("settings.describe", authority);
    await expectDenied("qaSurface/describe", `untrusted.example:${port}`);
    console.log(
      "packed DSH QA smoke: LAN navigation, QA configuration and access restrictions passed",
    );
  } catch (error) {
    hostLog.push(...log);
    throw error;
  } finally {
    await stopProcess(host);
  }
}
