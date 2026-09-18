import path from "node:path";
import { describe, expect, test } from "vitest";

import { DocumentError } from "../src/documents/errors.js";
import {
  buildProcessEnv,
  runProcess,
} from "../src/documents/providers/process.js";

import {
  argvLog,
  dir,
  docxSrc,
  logPath,
  pdfSrc,
  stubPandoc,
} from "./documents-providers.helpers.js";

describe("process runner", () => {
  test("withholds ambient environment variables from the backend", async () => {
    const planted = "DSH_DOCUMENTS_TEST_SECRET";
    const previous = process.env[planted];
    process.env[planted] = "should-not-leak";
    try {
      const result = await runProcess(
        process.execPath,
        [
          stubPandoc,
          docxSrc,
          pdfSrc,
          logPath,
          "ok",
          `--output=${path.join(dir, "env.docx")}`,
          "--to=docx",
        ],
        {
          timeoutMs: 20_000,
          maxStdoutBytes: 1024,
          backend: "stub",
          context: "testing",
          programPrefixArgs: [],
        },
      );
      expect(result.exitCode).toBe(0);
      const call = (await argvLog())[0];
      expect(call?.env).toContain("PATH");
      expect(call?.env).not.toContain(planted);
    } finally {
      if (previous === undefined) delete process.env[planted];
      else process.env[planted] = previous;
    }
  });

  test("buildProcessEnv keeps only the allow-listed variables", () => {
    const env = buildProcessEnv(undefined, {
      PATH: "/usr/bin",
      HOME: "/home/qa",
      SystemRoot: "C:\\Windows",
      AWS_SECRET_ACCESS_KEY: "nope",
      HTTP_PROXY: "http://proxy",
    });
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH", "SystemRoot"]);
  });

  test("kills a backend that floods stdout", async () => {
    const result = await runProcess(
      process.execPath,
      [stubPandoc, docxSrc, pdfSrc, logPath, "spam"],
      {
        timeoutMs: 20_000,
        maxStdoutBytes: 4_096,
        backend: "stub",
        context: "testing",
      },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4_096);
  });

  test("reports a missing executable as BACKEND_UNAVAILABLE", async () => {
    await expect(
      runProcess(path.join(dir, "nope"), [], {
        timeoutMs: 1_000,
        maxStdoutBytes: 100,
        backend: "stub",
        context: "testing",
      }),
    ).rejects.toBeInstanceOf(DocumentError);
  });
});
