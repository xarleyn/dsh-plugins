import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverBash } from "./run-bash.mjs";

function windowsDiscovery({ env = {}, existing = [], path = {} } = {}) {
  const existingPaths = new Set(existing);
  return () => discoverBash({
    platform: "win32",
    env,
    exists: (candidate) => existingPaths.has(candidate),
    findOnPath: (executable) => path[executable] ?? [],
  });
}

describe("discoverBash", () => {
  it("uses bash directly outside Windows", () => {
    assert.equal(discoverBash({ platform: "linux" }), "bash");
  });

  it("prefers an explicit DSH_BASH_PATH", () => {
    const explicit = "D:\\portable\\git\\usr\\bin\\bash.exe";
    const discover = windowsDiscovery({
      env: { DSH_BASH_PATH: explicit },
      existing: [explicit],
      path: { "bash.exe": ["C:\\other\\bin\\bash.exe"] },
    });

    assert.equal(discover(), explicit);
  });

  it("accepts an MSYS bash from PATH and skips the WSL launcher", () => {
    const wsl = "C:\\Windows\\System32\\bash.exe";
    const gitBash = "C:\\tools\\portable-git\\usr\\bin\\bash.exe";
    const discover = windowsDiscovery({
      existing: [wsl, gitBash],
      path: { "bash.exe": [wsl, gitBash] },
    });

    assert.equal(discover(), gitBash);
  });

  it("derives Git Bash from a git.exe found on PATH", () => {
    const git = "C:\\Users\\dev\\scoop\\apps\\git\\current\\cmd\\git.exe";
    const bash = "C:\\Users\\dev\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe";
    const discover = windowsDiscovery({
      existing: [bash],
      path: { "git.exe": [git] },
    });

    assert.equal(discover(), bash);
  });

  it("falls back to ProgramFiles Git Bash", () => {
    const bash = "D:\\Apps\\Git\\bin\\bash.exe";
    const discover = windowsDiscovery({
      env: { ProgramFiles: "D:\\Apps" },
      existing: [bash],
    });

    assert.equal(discover(), bash);
  });

  it("reports every checked source when discovery fails", () => {
    const explicit = "D:\\missing\\bash.exe";
    const wsl = "C:\\Windows\\System32\\bash.exe";
    const git = "C:\\portable\\cmd\\git.exe";
    const discover = windowsDiscovery({
      env: { DSH_BASH_PATH: explicit, ProgramFiles: "D:\\Programs" },
      path: { "bash.exe": [wsl], "git.exe": [git] },
    });

    assert.throws(discover, (error) => {
      assert.match(error.message, /Git Bash is required/u);
      assert.match(error.message, /DSH_BASH_PATH: D:\\missing\\bash\.exe \(not found\)/u);
      assert.match(error.message, /PATH \(where\.exe bash\.exe\).*not an MSYS Git Bash path/u);
      assert.match(error.message, /PATH \(where\.exe git\.exe\): C:\\portable\\cmd\\git\.exe/u);
      assert.match(error.message, /D:\\Programs\\Git\\usr\\bin\\bash\.exe \(not found\)/u);
      assert.match(error.message, /Set DSH_BASH_PATH/u);
      return true;
    });
  });
});
