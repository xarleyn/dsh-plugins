import { DocImpactEngine } from "../src/engine/runtime.js";
import type {
  EngineOptions,
  EngineWorkspaceConfig,
} from "../src/engine/runtime.js";
import { normalizeConfig } from "../src/config/normalize.js";
import type {
  ChangeDetector,
  FileChange,
  FileSnapshot,
  TurnBaseline,
} from "../src/index.js";

/** In-memory ChangeDetector over a mutable file universe. */
export function fakeDetector(state: Map<string, string>): ChangeDetector {
  const snapshot = (): Map<string, FileSnapshot> => {
    const files = new Map<string, FileSnapshot>();
    for (const [path, content] of state)
      files.set(path, { exists: true, hash: content });
    return files;
  };
  return {
    kind: "filesystem",
    async captureBaseline(cwd): Promise<TurnBaseline> {
      return {
        cwd,
        kind: "filesystem",
        files: snapshot(),
        createdAt: Date.now(),
        degraded: false,
      };
    },
    async computeChanges(_cwd: string, baseline: TurnBaseline) {
      const current = snapshot();
      const changes: FileChange[] = [];
      for (const path of new Set([
        ...baseline.files.keys(),
        ...current.keys(),
      ])) {
        const before = baseline.files.get(path);
        const after = current.get(path);
        if (before === undefined && after !== undefined)
          changes.push({ path, type: "added" });
        else if (before !== undefined && after === undefined)
          changes.push({ path, type: "deleted" });
        else if (
          before !== undefined &&
          after !== undefined &&
          before.hash !== after.hash
        ) {
          changes.push({ path, type: "modified" });
        }
      }
      return { changes, degraded: false };
    },
    async listFiles() {
      return [...state.keys()].sort();
    },
  };
}

export function workspace(
  rules: unknown,
  overrides: Partial<EngineWorkspaceConfig> = {},
): EngineWorkspaceConfig {
  return {
    config: normalizeConfig({ version: 1, rules }),
    safety: { maxReminderRounds: 2, onLimit: "allow" },
    maxSnapshotFiles: 1000,
    debug: false,
    ...overrides,
  };
}

export const AUTH_RULE = [
  {
    id: "auth",
    code: ["src/auth/**"],
    docs: ["docs/authentication.md"],
    direction: "code-to-docs",
    mode: "require-resolution",
  },
];

export function engineWith(
  ws: EngineWorkspaceConfig,
  state: Map<string, string>,
  options: Partial<EngineOptions> = {},
): DocImpactEngine {
  const detector = fakeDetector(state);
  return new DocImpactEngine({
    configProvider: async () => ws,
    logger: { warn() {}, info() {}, error() {} },
    detectorFactory: () => detector,
    ...options,
  });
}
