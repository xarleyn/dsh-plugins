import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import http from "node:http";

/** Run a command to completion, rejecting with its captured output on failure. */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
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

/** Reserve an unused loopback TCP port and release it again. */
export async function freePort() {
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

/** Poll an async check until it returns a truthy value or the deadline passes. */
export async function waitFor(check, description, timeoutMs = 60_000) {
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

/** Issue one browser-trust RPC envelope against the DSH gateway. */
export async function rpc(origin, method, payload) {
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

/**
 * One HTTP request against the loopback socket with an explicit Host header.
 * The /api browser-trust fence judges the Host header, so this speaks with
 * the exact authority a real LAN browser would send while the connection
 * itself never leaves loopback.
 */
export function requestWithAuthority(port, authority, path, payload) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: payload === undefined ? "GET" : "POST",
        headers: {
          host: authority,
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8").on("data", (chunk) => (raw += chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: raw,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}

/** Terminate a spawned host gracefully, resolving once it is gone. */
export function stopProcess(child) {
  return new Promise((resolve) => {
    if (child === undefined || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}
