import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http, { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

import { chromium } from "playwright";

import { systemBrowserCandidates } from "../src/host/providers/playwright.js";

/**
 * A browser to start outside the runtime under test.
 *
 * The suite is opt-in because it needs a real Chromium, not because it needs to
 * be told which one, so the executable is found the way the launch path finds
 * it and `DSH_QA_BROWSER_EXECUTABLE` only overrides that. The attach case then
 * joins a browser the runtime could have started itself — which is the point:
 * what separates the modes is who owns the process, not where the binary came
 * from. A run that was asked for and found nothing fails rather than skipping:
 * a skipped attach case is the one result this card's claim cannot be read from.
 */
export function discoverChromium(): string {
  const explicit = process.env["DSH_QA_BROWSER_EXECUTABLE"];
  if (explicit !== undefined) {
    if (!existsSync(explicit)) {
      throw new Error(
        `DSH_QA_BROWSER_EXECUTABLE names ${explicit}, which is not there`,
      );
    }
    return explicit;
  }
  let candidates = [...systemBrowserCandidates()];
  try {
    // Playwright names its own build even where it was never downloaded.
    candidates = [chromium.executablePath(), ...candidates];
  } catch {
    // No registry entry to read: the installed browsers still stand.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      "no Chromium to attach to: install Chrome, Chromium or Edge, or name a " +
        "binary with DSH_QA_BROWSER_EXECUTABLE",
    );
  }
  return found;
}

/** Free a port the external Chromium can be asked to listen on. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * A Chromium this runtime did not start and does not own — which is the whole
 * claim attach mode makes, so the test starts the browser the way a person or a
 * sidecar would: by running it with a debug port.
 *
 * `extraArgs` carries a flag the case is asking about. What a DevTools endpoint
 * answers is the browser's answer, so a claim that some Chromium flag changes
 * nothing is only readable off a browser started with that flag set.
 */
export async function startExternalChromium(
  executable: string,
  port: number,
  extraArgs: readonly string[] = [],
): Promise<{ child: ChildProcess; userDataDir: string }> {
  const userDataDir = await mkdtemp(join(tmpdir(), "qa-browser-attach-"));
  const child = spawn(
    executable,
    [
      "--headless=new",
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...extraArgs,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const answered = await fetch(
        `http://127.0.0.1:${String(port)}/json/version`,
      );
      if (answered.ok) return { child, userDataDir };
    } catch {
      // The port is not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(
        `Chromium did not open its CDP endpoint on ${String(port)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Ask the browser to quit over its own protocol, then stop waiting if it did. */
export async function stopExternalChromium(
  child: ChildProcess,
  port: number,
): Promise<void> {
  let closed = false;
  try {
    const version = (await (
      await fetch(`http://127.0.0.1:${String(port)}/json/version`)
    ).json()) as { webSocketDebuggerUrl?: string };
    if (version.webSocketDebuggerUrl !== undefined) {
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise<void>((resolve) =>
        socket.addEventListener("open", () => resolve()),
      );
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      socket.close();
      closed = true;
    }
  } catch {
    // Already gone, or unreachable: the fallback below handles both.
  }
  if (!closed) child.kill();
  const exited = await Promise.race([
    waitForExit(child).then(() => "exit" as const),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 5_000),
    ),
  ]);
  child.kill();
  if (exited === "timeout") {
    throw new Error("the external Chromium outlived its own teardown");
  }
}

/**
 * Resolve once the browser process is gone. A kill leaves `exitCode` null and
 * the signal set, so neither field alone answers the question — and waiting for
 * an `exit` that has already been announced would wait forever.
 */
export async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

/**
 * Drop the profile directory an external browser was started with.
 *
 * A Chrome that has just exited can still hold a handle on its own files for a
 * moment, and on Windows `rm` reads that as `EBUSY` and gives up — a teardown
 * failure that says nothing about the runtime under test, on the platform the
 * README tells people to run this suite from. The retries are Node's own for
 * exactly this error class, so the wait is for the handle rather than for a
 * process the case already waited out.
 */
export async function removeProfileDir(userDataDir: string): Promise<void> {
  await rm(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
}

/**
 * Ask a browser's DevTools server the two hops an endpoint makes — the
 * `/json/version` question an `http` endpoint asks and the `ws` upgrade its
 * answer names — under headers that are written down rather than inferred.
 *
 * Which request a browser answers is the browser's own decision, taken before
 * this runtime is involved, and it is the question a deployment asks its sidecar
 * guide. So the request leaves carrying the header the guide is being checked on:
 * `host` is the literal `Host` value to send, and `origin` is the `Origin` a page
 * puts on a request it starts from itself.
 *
 * The answer is a status code; a browser that is not there at all fails the probe
 * rather than answering, so a refusal is never read off a process that never came
 * up.
 *
 * Every question goes out over its own connection (`agent: false`): a Node socket
 * pooled after one request would carry the next header over the connection the
 * browser is already done with, and the reset that follows reads as an answer the
 * browser never gave.
 */
export async function devToolsHostProbe(
  debugPort: number,
): Promise<
  (request: {
    readonly host: string;
    readonly socket?: boolean;
    readonly origin?: string;
  }) => Promise<number>
> {
  const version = (await (
    await fetch(`http://127.0.0.1:${String(debugPort)}/json/version`)
  ).json()) as { webSocketDebuggerUrl?: string };
  expect(typeof version.webSocketDebuggerUrl).toBe("string");
  const socketPath = new URL(version.webSocketDebuggerUrl ?? "").pathname;
  return ({ host, socket = false, origin }) =>
    new Promise<number>((resolve, reject) => {
      const headers: Record<string, string> = { host };
      if (origin !== undefined) headers["origin"] = origin;
      if (socket) {
        headers["connection"] = "Upgrade";
        headers["upgrade"] = "websocket";
        headers["sec-websocket-key"] = randomBytes(16).toString("base64");
        headers["sec-websocket-version"] = "13";
      }
      const request = http.request(
        {
          host: "127.0.0.1",
          port: debugPort,
          path: socket ? socketPath : "/json/version",
          headers,
          agent: false,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("upgrade", (_response, socketStream) => {
        socketStream.destroy();
        resolve(101);
      });
      request.on("error", reject);
      request.end();
    });
}

/**
 * Run `body` against a Chromium this runtime only joins, and stop that browser
 * afterwards. The cases that need one are the gates and the teardown of a
 * borrowed browser — the parts a launched Chromium cannot stand in for.
 */
export async function withAttachedChromium(
  body: (endpoint: string) => Promise<void>,
): Promise<void> {
  const executable = discoverChromium();
  const debugPort = await freePort();
  const external = await startExternalChromium(executable, debugPort);
  try {
    await body(`http://127.0.0.1:${String(debugPort)}`);
  } finally {
    await stopExternalChromium(external.child, debugPort);
    await removeProfileDir(external.userDataDir);
  }
}
