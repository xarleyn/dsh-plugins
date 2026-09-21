/**
 * The host-side settings section.
 *
 * A card is rendered only for a namespace the live plugin registered in the
 * Host's settings directory, so this registration is what makes the card
 * reachable at all — the browser bundle alone renders nothing. The section is
 * also the plugin's configuration source: a committed change has to reach a
 * session that is already running, which is asserted here as "the request that
 * would have been issued is not issued".
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFakeAgent,
  createHarness,
  emit,
  enterDecision,
  preStepPayload,
  userMessage,
  type Harness,
} from "./helpers/harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/**
 * What a fake settings service hands back to the test: the registration, plus
 * the two hooks the service drives — `setSource` (a reader over the merged
 * layers) and `onChange` (a committed change).
 */
interface InstalledSection {
  readonly namespace: string;
  readonly owner: unknown;
  readonly entry: Record<string, unknown>;
  setSource: (current: () => unknown) => void;
  onChange: () => void;
}

/** A settings service that records what the plugin installs. */
function settingsService(): {
  readonly installed: InstalledSection[];
  readonly service: {
    installSection(
      owner: unknown,
      namespace: string,
      schema: unknown,
      entry: unknown,
      hooks: {
        setSource(current: () => unknown): void;
        onChange(): void;
      },
    ): void;
  };
} {
  const installed: InstalledSection[] = [];
  return {
    installed,
    service: {
      installSection: (owner, namespace, _schema, entry, hooks) => {
        installed.push({
          namespace,
          owner,
          entry: entry as Record<string, unknown>,
          setSource: hooks.setSource,
          onChange: hooks.onChange,
        });
      },
    },
  };
}

/** Drive one step that reaches `enter`, and report how many recalls it made. */
async function stepRecalls(
  target: Harness,
  sessionId: string,
): Promise<number> {
  const { agent } = createFakeAgent({ sessionId });
  await emit(target, "agent/session-start", { agent });
  const payload = preStepPayload(agent, [
    userMessage("what did we decide about the release plan?"),
  ]);
  const before = target.countRequests("/api/v1/search/search");
  await emit(target, "agent/pre-step", payload, () =>
    Promise.resolve(enterDecision(payload.messages)),
  );
  return target.countRequests("/api/v1/search/search") - before;
}

describe("settings section", () => {
  it("registers the namespace the card is keyed by", async () => {
    const { installed, service } = settingsService();
    harness = await createHarness({}, { settings: service });

    // The registration happens from an injected child context, so it lands
    // after the constructor returns.
    await vi.waitFor(() => {
      expect(installed).toHaveLength(1);
    });
    expect(installed[0]?.namespace).toBe("dsh-openviking-memory");
    // The entry is the composition config, plus the isolated settings file the
    // harness points the plugin at.
    expect(Object.keys(installed[0]?.entry ?? {})).toEqual([
      "qaUserSettingsPath",
    ]);
    expect(installed[0]?.onChange).toBeTypeOf("function");
  });

  it("hands the composition entry over as the base layer", async () => {
    const { installed, service } = settingsService();
    harness = await createHarness(
      { endpoint: "http://memory.example:1933", autoInject: false },
      { settings: service },
    );

    await vi.waitFor(() => {
      expect(installed).toHaveLength(1);
    });
    expect(installed[0]?.entry).toMatchObject({
      endpoint: "http://memory.example:1933",
      autoInject: false,
    });
  });

  it("applies a committed change to the requests of a running session", async () => {
    const { installed, service } = settingsService();
    harness = await createHarness({}, { settings: service });
    await vi.waitFor(() => {
      expect(installed).toHaveLength(1);
    });

    expect(await stepRecalls(harness, "dsh-session-1")).toBeGreaterThan(0);

    // The operator switches automatic recall off in the card; the settings
    // service reports the new merged value.
    installed[0]?.setSource(() => ({ autoRecall: false }));
    installed[0]?.onChange();

    expect(harness.plugin.injection.recall).toBe(false);
    expect(await stepRecalls(harness, "dsh-session-2")).toBe(0);
  });

  it("re-reads the configuration of a session that is already running", async () => {
    const { installed, service } = settingsService();
    harness = await createHarness({}, { settings: service });
    await vi.waitFor(() => {
      expect(installed).toHaveLength(1);
    });

    // A session exists, then the endpoint changes under it.
    const { agent } = createFakeAgent({ sessionId: "dsh-session-1" });
    await emit(harness, "agent/session-start", { agent });
    installed[0]?.setSource(() => ({ endpoint: "http://elsewhere.example" }));
    installed[0]?.onChange();

    const payload = preStepPayload(agent, [
      userMessage("what did we decide about the release plan?"),
    ]);
    const before = harness.countRequests("/api/v1/search/search");
    await emit(harness, "agent/pre-step", payload, () =>
      Promise.resolve(enterDecision(payload.messages)),
    );
    expect(harness.countRequests("/api/v1/search/search")).toBeGreaterThan(
      before,
    );
    expect(harness.plugin.resolved.endpoint).toBe("http://elsewhere.example");
  });

  it("goes back to the composition entry when the provider detaches", async () => {
    const { installed, service } = settingsService();
    harness = await createHarness(
      { endpoint: "http://memory.example:1933", autoInject: false },
      { settings: service },
    );
    await vi.waitFor(() => {
      expect(installed).toHaveLength(1);
    });

    // The provider hands over the merged layers, then detaches and restores
    // the entry — which is what the service does when it unloads.
    installed[0]?.setSource(() => ({
      endpoint: "http://elsewhere.example",
      autoInject: false,
    }));
    installed[0]?.onChange();
    expect(harness.plugin.resolved.endpoint).toBe("http://elsewhere.example");
    expect(harness.plugin.injection.recall).toBe(false);

    installed[0]?.setSource(() => installed[0]?.entry ?? {});
    installed[0]?.onChange();

    expect(harness.plugin.resolved.endpoint).toBe("http://memory.example:1933");
    expect(harness.plugin.injection.recall).toBe(false);
  });
});
