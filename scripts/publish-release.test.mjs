import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import {
  inspectWave,
  publishArguments,
  publishedRange,
  publishFailureMessage,
  publishOrder,
  publishWave,
  registryVersions,
  releaseEdges,
  satisfiesRange,
  verifyInstalls,
  workspaceManifests,
} from "./publish-release.mjs";

const script = fileURLToPath(new URL("./publish-release.mjs", import.meta.url));
const fixtures = [];

after(() => {
  for (const directory of fixtures) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * A workspace shaped like the repository's: a group directory per package
 * kind, one manifest each, versions as the release commit leaves them.
 */
function createWorkspace(packages) {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-publish-"));
  fixtures.push(root);

  for (const [name, manifest] of Object.entries(packages)) {
    // The workspace layout is one directory per package, not per scope.
    const directory = path.join(
      root,
      manifest.group ?? "plugins",
      name.replace(/^@[^/]+\//u, ""),
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name, version: manifest.version, ...manifest.fields }),
    );
  }

  return root;
}

function releaseRow(name, version, group = "plugins") {
  return {
    name,
    version,
    directory: `${group}/${name.replace("@yadsh/", "")}`,
    tarball: `${name.replace("@yadsh/", "yadsh-")}-${version}.tgz`,
  };
}

describe("published ranges", () => {
  test("the workspace protocol becomes the range a consumer resolves", () => {
    assert.equal(publishedRange("workspace:^", "0.3.0"), "^0.3.0");
    assert.equal(publishedRange("workspace:~", "0.3.0"), "~0.3.0");
    assert.equal(publishedRange("workspace:*", "0.3.0"), "0.3.0");
    assert.equal(publishedRange("workspace:>=1.0.0", "0.3.0"), ">=1.0.0");
    assert.equal(publishedRange("^0.4.0", "0.3.0"), "^0.4.0");
  });

  test("a workspace protocol naming nothing in the workspace is refused", () => {
    assert.throws(
      () => publishedRange("workspace:", "0.3.0"),
      /names no version/u,
    );
  });
});

describe("the npm invocation", () => {
  test("a tarball is published publicly, and only a dry run says otherwise", () => {
    assert.deepEqual(publishArguments("/tarballs/a-1.0.0.tgz"), [
      "publish",
      "/tarballs/a-1.0.0.tgz",
      "--access",
      "public",
    ]);
    assert.deepEqual(
      publishArguments("/tarballs/a-1.0.0.tgz", { dryRun: true }).at(-1),
      "--dry-run",
    );
  });
});

describe("range satisfaction", () => {
  const cases = [
    ["0.3.0", "^0.3.0", true],
    ["0.3.7", "^0.3.0", true],
    ["0.4.0", "^0.3.0", false],
    ["0.2.9", "^0.3.0", false],
    ["1.2.9", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["1.3.0", "^1.2.3", true],
    ["0.0.5", "^0.0.5", true],
    ["0.0.6", "^0.0.5", false],
    ["0.3.2", "~0.3.0", true],
    ["0.4.0", "~0.3.0", false],
    ["0.3.0", "0.3.0", true],
    ["0.3.1", "0.3.0", false],
    ["2.0.0", "*", true],
    ["1.5.0", ">=1.0.0 <2.0.0", true],
    ["2.0.0", ">=1.0.0 <2.0.0", false],
    // A prerelease is only accepted by a range that asks for one: the version
    // npm would install for `^0.3.0` is never `0.3.0-rc.1`.
    ["0.3.0-rc.1", "^0.3.0", false],
    ["0.3.0-rc.2", "^0.3.0-rc.1", true],
    ["0.3.0", "^0.3.0-rc.1", true],
    ["0.4.0-rc.1", "^0.3.0-rc.1", false],
  ];

  for (const [version, range, expected] of cases) {
    test(`${version} ${expected ? "satisfies" : "does not satisfy"} ${range}`, () => {
      assert.equal(satisfiesRange(version, range), expected);
    });
  }

  test("a range outside the algebra is refused, not guessed", () => {
    assert.throws(
      () => satisfiesRange("1.0.0", ">=1.0.0 || >=2.0.0"),
      /is not a comparator this gate reads/u,
    );
    assert.throws(
      () => satisfiesRange("not-a-version", "^1.0.0"),
      /is not a version this gate reads/u,
    );
  });
});

describe("wave composition", () => {
  test("the workspace manifests are read by package name", () => {
    const root = createWorkspace({
      "@yadsh/dsh-a": { version: "1.0.0", fields: {} },
      "@yadsh/dsh-kit": {
        version: "0.3.0",
        group: "packages",
        fields: {},
      },
    });
    mkdirSync(path.join(root, "plugins", "not-a-package"), { recursive: true });

    const manifests = workspaceManifests(root);
    assert.deepEqual([...manifests.keys()].sort(), [
      "@yadsh/dsh-a",
      "@yadsh/dsh-kit",
    ]);
    assert.equal(manifests.get("@yadsh/dsh-kit").version, "0.3.0");
  });

  test("a dependency is published before the package that needs it", () => {
    const rows = [
      releaseRow("@yadsh/dsh-surface", "0.9.0"),
      releaseRow("@yadsh/dsh-kit", "0.3.0", "packages"),
      releaseRow("@yadsh/dsh-middle", "0.2.0"),
    ];
    const manifests = new Map([
      [
        "@yadsh/dsh-surface",
        { dependencies: { "@yadsh/dsh-middle": "workspace:^" } },
      ],
      [
        "@yadsh/dsh-middle",
        { dependencies: { "@yadsh/dsh-kit": "workspace:^" } },
      ],
      ["@yadsh/dsh-kit", {}],
    ]);
    const { requires } = releaseEdges(rows, manifests);

    assert.deepEqual(
      publishOrder(rows, { requires }).map((row) => row.name),
      ["@yadsh/dsh-kit", "@yadsh/dsh-middle", "@yadsh/dsh-surface"],
    );
  });

  test("independent packages keep one order between runs", () => {
    const rows = [
      releaseRow("@yadsh/dsh-b", "1.0.0"),
      releaseRow("@yadsh/dsh-a", "1.0.0"),
    ];
    const { requires } = releaseEdges(rows, new Map());

    assert.deepEqual(
      publishOrder(rows, { requires }).map((row) => row.name),
      ["@yadsh/dsh-a", "@yadsh/dsh-b"],
    );
  });

  test("a dependency cycle is refused instead of published half ordered", () => {
    const rows = [
      releaseRow("@yadsh/dsh-a", "1.0.0"),
      releaseRow("@yadsh/dsh-b", "1.0.0"),
    ];
    const manifests = new Map([
      ["@yadsh/dsh-a", { dependencies: { "@yadsh/dsh-b": "workspace:^" } }],
      ["@yadsh/dsh-b", { dependencies: { "@yadsh/dsh-a": "workspace:^" } }],
    ]);
    const { requires } = releaseEdges(rows, manifests);

    assert.throws(
      () => publishOrder(rows, { requires }),
      /dependency cycle: @yadsh\/dsh-a, @yadsh\/dsh-b/u,
    );
  });
});

describe("release dependencies", () => {
  function waveManifests(packages) {
    const root = createWorkspace(packages);
    return workspaceManifests(root);
  }

  test("a range the wave itself satisfies is accepted", async () => {
    const manifests = waveManifests({
      "@yadsh/dsh-surface": {
        version: "0.9.0",
        fields: { dependencies: { "@yadsh/dsh-kit": "workspace:^" } },
      },
      "@yadsh/dsh-kit": { version: "0.3.0", group: "packages", fields: {} },
    });
    const rows = [
      releaseRow("@yadsh/dsh-surface", "0.9.0"),
      releaseRow("@yadsh/dsh-kit", "0.3.0", "packages"),
    ];

    const { failures } = await inspectWave(rows, { manifests });
    assert.deepEqual(failures, []);
  });

  test("a dependency outside the wave has to be on the registry", async () => {
    const manifests = waveManifests({
      "@yadsh/dsh-surface": {
        version: "0.9.0",
        fields: { dependencies: { "@yadsh/dsh-kit": "workspace:^" } },
      },
      "@yadsh/dsh-kit": { version: "0.3.0", group: "packages", fields: {} },
    });
    const rows = [releaseRow("@yadsh/dsh-surface", "0.9.0")];
    const lookup = async () => ["0.2.0"];

    const { failures } = await inspectWave(rows, { manifests, lookup });

    assert.equal(failures.length, 1);
    assert.match(
      failures[0].reason,
      /neither this release nor npm has a version \^0\.3\.0/u,
    );
    assert.equal(failures[0].dependency, "@yadsh/dsh-kit");

    const published = await inspectWave(rows, {
      manifests,
      lookup: async () => ["0.3.0"],
    });
    assert.deepEqual(published.failures, []);
  });

  test("a catalog range is left to the packed manifest, not expanded twice", async () => {
    const manifests = waveManifests({
      "@yadsh/dsh-surface": {
        version: "0.9.0",
        fields: {
          dependencies: { playwright: "catalog:tooling" },
        },
      },
    });
    const rows = [releaseRow("@yadsh/dsh-surface", "0.9.0")];
    const looked = [];

    const { failures } = await inspectWave(rows, {
      manifests,
      lookup: async (name) => {
        looked.push(name);
        return [];
      },
    });

    // pnpm rewrites catalog: at pack time and tarball-verify gate 6 reads the
    // result, so the preflight neither resolves it nor asks npm about it.
    assert.deepEqual(failures, []);
    assert.deepEqual(looked, []);
  });
});

describe("publishing the wave", () => {
  const tarballs = mkdtempSync(path.join(tmpdir(), "dsh-tarballs-"));
  fixtures.push(tarballs);

  /** Wave rows whose tarballs the run packed, as the release job sees them. */
  function rows(...specs) {
    return specs.map(([name, version]) => {
      const row = releaseRow(name, version);
      const tarballPath = path.join(tarballs, row.tarball);
      writeFileSync(tarballPath, "");
      return { ...row, tarballPath };
    });
  }

  test("an already published version is adopted, not republished", async () => {
    const order = rows(
      ["@yadsh/dsh-kit", "0.3.0"],
      ["@yadsh/dsh-surface", "0.9.0"],
    );
    const published = [];
    const events = [];
    const { requires, dependents } = {
      requires: new Map([
        ["@yadsh/dsh-kit", []],
        ["@yadsh/dsh-surface", ["@yadsh/dsh-kit"]],
      ]),
      dependents: new Map([
        ["@yadsh/dsh-kit", ["@yadsh/dsh-surface"]],
        ["@yadsh/dsh-surface", []],
      ]),
    };

    const result = await publishWave(order, {
      requires,
      dependents,
      isPublished: async (row) => row.name === "@yadsh/dsh-kit",
      publish: async (row) => {
        published.push(row.name);
        return { ok: true, output: "" };
      },
      onEvent: (line) => events.push(line),
    });

    assert.deepEqual(published, ["@yadsh/dsh-surface"]);
    assert.deepEqual(
      result.published.map((row) => row.name),
      ["@yadsh/dsh-surface"],
      "an adopted version is not counted as published by this run",
    );
    assert.deepEqual(
      result.adopted.map((row) => row.name),
      ["@yadsh/dsh-kit"],
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.skipped, []);
    assert.match(
      events.join("\n"),
      /Adopting @yadsh\/dsh-kit@0\.3\.0: already published/u,
    );
  });

  test("a dependency that failed holds its dependents back", async () => {
    const order = rows(
      ["@yadsh/dsh-kit", "0.3.0"],
      ["@yadsh/dsh-surface", "0.9.0"],
      ["@yadsh/dsh-page", "0.4.0"],
      ["@yadsh/dsh-alone", "1.0.0"],
    );
    const published = [];

    const result = await publishWave(order, {
      requires: new Map([
        ["@yadsh/dsh-kit", []],
        ["@yadsh/dsh-surface", ["@yadsh/dsh-kit"]],
        ["@yadsh/dsh-page", ["@yadsh/dsh-surface"]],
        ["@yadsh/dsh-alone", []],
      ]),
      dependents: new Map([
        ["@yadsh/dsh-kit", ["@yadsh/dsh-surface"]],
        ["@yadsh/dsh-surface", ["@yadsh/dsh-page"]],
        ["@yadsh/dsh-page", []],
        ["@yadsh/dsh-alone", []],
      ]),
      isPublished: async () => false,
      publish: async (row) => {
        published.push(row.name);
        return row.name === "@yadsh/dsh-kit"
          ? { ok: false, output: "npm error 404 Not Found" }
          : { ok: true, output: "" };
      },
      onEvent: () => {},
    });

    // The shared package failed, so nothing that installs from it went out;
    // the unrelated package still did.
    assert.deepEqual(published, ["@yadsh/dsh-kit", "@yadsh/dsh-alone"]);
    assert.deepEqual(
      result.skipped.map((item) => item.name),
      ["@yadsh/dsh-surface", "@yadsh/dsh-page"],
    );
    assert.deepEqual(
      result.failed.map((item) => item.name),
      ["@yadsh/dsh-kit"],
    );
    assert.match(
      result.skipped[1].reason,
      /@yadsh\/dsh-surface was not published/u,
    );
  });

  test("a refused publish explains the publisher, not the status code", async () => {
    const written = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      await publishWave(rows(["@yadsh/dsh-kit", "0.3.0"]), {
        requires: new Map([["@yadsh/dsh-kit", []]]),
        dependents: new Map([["@yadsh/dsh-kit", []]]),
        isPublished: async () => false,
        publish: async () => ({ ok: false, output: "npm error 404 Not Found" }),
        onEvent: () => {},
      });
    } finally {
      process.stderr.write = original;
    }

    assert.match(written.join("\n"), /Trusted Publisher/u);
    assert.match(
      publishFailureMessage("@yadsh/dsh-kit", "0.3.0"),
      /xarleyn\/dsh-plugins/u,
    );
  });

  test("a publish race with an earlier run adopts the version instead of failing", async () => {
    const order = rows(
      ["@yadsh/dsh-kit", "0.3.0"],
      ["@yadsh/dsh-surface", "0.9.0"],
    );
    const published = [];

    const result = await publishWave(order, {
      requires: new Map([
        ["@yadsh/dsh-kit", []],
        ["@yadsh/dsh-surface", ["@yadsh/dsh-kit"]],
      ]),
      dependents: new Map([
        ["@yadsh/dsh-kit", ["@yadsh/dsh-surface"]],
        ["@yadsh/dsh-surface", []],
      ]),
      // The registry document this run read was written before the version
      // existed, which is what a rerun minutes later can still see.
      isPublished: async () => false,
      publish: async (row) => {
        published.push(row.name);
        return row.name === "@yadsh/dsh-kit"
          ? {
              ok: false,
              output:
                "npm error code E403\nnpm error 403 Forbidden - PUT https://registry.npmjs.org/@yadsh%2fdsh-kit - You cannot publish over the previously published versions: 0.3.0.",
            }
          : { ok: true, output: "" };
      },
      onEvent: () => {},
    });

    assert.deepEqual(
      result.adopted.map((row) => row.name),
      ["@yadsh/dsh-kit"],
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.skipped, []);
    // The dependent publishes: a version npm already has satisfies it.
    assert.deepEqual(published, ["@yadsh/dsh-kit", "@yadsh/dsh-surface"]);
  });

  test("a tarball the run never packed fails its dependents", async () => {
    const order = rows(
      ["@yadsh/dsh-kit", "0.3.0"],
      ["@yadsh/dsh-surface", "0.9.0"],
    );
    rmSync(order[0].tarballPath);

    const result = await publishWave(order, {
      requires: new Map([
        ["@yadsh/dsh-kit", []],
        ["@yadsh/dsh-surface", ["@yadsh/dsh-kit"]],
      ]),
      dependents: new Map([
        ["@yadsh/dsh-kit", ["@yadsh/dsh-surface"]],
        ["@yadsh/dsh-surface", []],
      ]),
      isPublished: async () => false,
      publish: async () => {
        throw new Error(
          "a package without a tarball must not reach npm publish",
        );
      },
      onEvent: () => {},
    });

    assert.deepEqual(
      result.failed.map((row) => row.name),
      ["@yadsh/dsh-kit"],
    );
    assert.match(result.failed[0].output, /no tarball at/u);
    assert.deepEqual(
      result.skipped.map((item) => item.name),
      ["@yadsh/dsh-surface"],
    );
  });
});

describe("the install check", () => {
  test("a published version a consumer cannot install is reported", async () => {
    const rows = [
      releaseRow("@yadsh/dsh-surface", "0.9.0"),
      releaseRow("@yadsh/dsh-kit", "0.3.0"),
    ];
    const events = [];

    const failures = await verifyInstalls(rows, {
      install: async (row) =>
        row.name === "@yadsh/dsh-surface"
          ? {
              ok: false,
              output:
                "npm error code ETARGET\nnpm error notarget No matching version found for @yadsh/dsh-kit@^0.3.0.",
            }
          : { ok: true, output: "" },
      onEvent: (line) => events.push(line),
    });

    assert.deepEqual(
      failures.map((item) => item.name),
      ["@yadsh/dsh-surface"],
    );
    assert.match(events.join("\n"), /Installs @yadsh\/dsh-kit@0\.3\.0/u);
  });

  test("a version the registry has not caught up with is waited for", async () => {
    const row = releaseRow("@yadsh/dsh-surface", "0.9.0");
    const events = [];
    const waits = [];
    let attempts = 0;

    const failures = await verifyInstalls([row], {
      install: async () => {
        attempts += 1;
        return attempts < 3
          ? {
              ok: false,
              output: `npm error notarget No matching version found for ${row.name}@${row.version}.`,
            }
          : { ok: true, output: "" };
      },
      wait: async (milliseconds) => waits.push(milliseconds),
      retryDelayMs: 5,
      onEvent: (line) => events.push(line),
    });

    assert.deepEqual(failures, []);
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [5, 5]);
    assert.match(events.join("\n"), /npm has not caught up with the publish/u);
  });

  test("a dependency that cannot resolve is failed at once, not retried", async () => {
    const row = releaseRow("@yadsh/dsh-surface", "0.9.0");
    let attempts = 0;

    const failures = await verifyInstalls([row], {
      install: async () => {
        attempts += 1;
        return {
          ok: false,
          output:
            "npm error notarget No matching version found for @yadsh/dsh-kit@^0.3.0.",
        };
      },
      wait: async () => {
        throw new Error("a missing dependency must not be waited for");
      },
      onEvent: () => {},
    });

    assert.equal(attempts, 1);
    assert.equal(failures.length, 1);
  });
});

describe("the release registry probe", () => {
  test("an unknown package is an empty version list", async () => {
    assert.deepEqual(
      await registryVersions("@yadsh/dsh-new", {
        fetchImpl: async () => ({ status: 404, ok: false }),
      }),
      [],
    );
  });

  test("a registry failure is not mistaken for an unknown package", async () => {
    await assert.rejects(
      registryVersions("@yadsh/dsh-any", {
        fetchImpl: async () => ({ status: 503, ok: false }),
      }),
      /answered 503 for @yadsh\/dsh-any/u,
    );
  });

  test("the versions come back from the packument", async () => {
    const versions = await registryVersions("@yadsh/dsh-any", {
      fetchImpl: async (url, options) => {
        assert.match(url, /registry\.npmjs\.org\/@yadsh%2Fdsh-any/u);
        assert.equal(
          options.headers.accept,
          "application/vnd.npm.install-v1+json",
        );
        return {
          status: 200,
          ok: true,
          json: async () => ({ versions: { "0.1.0": {}, "0.2.0": {} } }),
        };
      },
    });

    assert.deepEqual(versions, ["0.1.0", "0.2.0"]);
  });
});

describe("the release dependency check on the command line", () => {
  function runCheck(root, rows) {
    const tsv = path.join(root, "release-packages.tsv");
    writeFileSync(
      tsv,
      rows
        .map(
          (row) =>
            `${row.name}\t${row.version}\t${row.directory}\t${row.tarball}`,
        )
        .join("\n"),
    );

    return spawnSync(
      process.execPath,
      [script, "--check", `--tsv=${tsv}`, `--root=${root}`],
      { encoding: "utf8" },
    );
  }

  test("a wave whose dependencies resolve passes", () => {
    const root = createWorkspace({
      "@yadsh/dsh-surface": {
        version: "0.9.0",
        fields: { dependencies: { "@yadsh/dsh-kit": "workspace:^" } },
      },
      "@yadsh/dsh-kit": { version: "0.3.0", group: "packages", fields: {} },
    });
    const result = runCheck(root, [
      releaseRow("@yadsh/dsh-surface", "0.9.0"),
      releaseRow("@yadsh/dsh-kit", "0.3.0", "packages"),
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 package\(s\) resolve/u);
  });

  test("a dependency no release provides stops the wave before it uploads", () => {
    const root = createWorkspace({
      "@yadsh/dsh-surface": {
        version: "0.9.0",
        fields: { dependencies: { "@yadsh/dsh-kit": "workspace:^" } },
      },
    });
    const result = runCheck(root, [releaseRow("@yadsh/dsh-surface", "0.9.0")]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /1 range\(s\) would not install/u);
    assert.match(result.stderr, /has no version for @yadsh\/dsh-kit/u);
    assert.match(result.stderr, /Add the missing package to the release/u);
  });

  test("the mode is required", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Pass exactly one of --check, --publish or --verify-install/u,
    );
  });
});
