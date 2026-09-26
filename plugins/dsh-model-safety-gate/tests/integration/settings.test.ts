/**
 * Live configuration. Since `0.1.7` the gate's editable settings are the
 * volatile nodes of its own entry configuration: the Host resolves each one
 * into a reference, the operator card writes through the form the settings
 * domain serves for this entry, and `loader/volatile-update` announces a
 * committed change to this fiber. This file holds the half that needs no
 * running gate — which nodes are live, and what reading them means; the
 * reaction of the running guards is covered in `service.test.ts`.
 */

import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";

import ModelSafetyGate from "../../src/index.js";
import {
  ModelSafetyGateConfigSchema,
  SAFETY_GATE_LIVE_NODES,
  snapshotSafetyGateConfig,
  type GateMode,
  type ModelSafetyGateEntryConfig,
} from "../../src/config.js";
import { SAFETY_GATE_SETTINGS_NAMESPACE } from "../../src/shared/settings.js";
import { liveNode } from "../helpers/live-node.js";

/** The nested schema nodes of every live top-level node. */
function childrenOfLiveNodes(): Array<Record<string, { meta?: unknown }>> {
  const { dict } = ModelSafetyGateConfigSchema as unknown as {
    dict: Record<string, { dict?: Record<string, { meta?: unknown }> }>;
  };
  return SAFETY_GATE_LIVE_NODES.map((node) => dict[node]?.dict ?? {});
}

describe("safety gate live configuration", () => {
  it("serves every node the card edits as a live form field", () => {
    const { dict } = ModelSafetyGateConfigSchema as unknown as {
      dict: Record<string, { meta?: { volatile?: boolean } }>;
    };
    for (const node of SAFETY_GATE_LIVE_NODES) {
      // A node the Host does not serve as live cannot be written from the card
      // at all, so the schema and the live-node list may not drift apart.
      expect(dict[node]?.meta?.volatile, node).toBe(true);
    }
  });

  it("keeps nested fields out of the live nodes", () => {
    // The Host refuses a volatile node under an enclosing volatile one, so only
    // the top-level nodes carry the marker and each container is written whole.
    for (const children of childrenOfLiveNodes()) {
      for (const [field, child] of Object.entries(children)) {
        expect(
          (child.meta as { volatile?: boolean } | undefined)?.volatile,
          field,
        ).not.toBe(true);
      }
    }
  });

  it("resolves each live node into a reference", () => {
    const resolved = ModelSafetyGateConfigSchema({
      mode: "audit",
      output: { mode: "observe" },
    }) as unknown as ModelSafetyGateEntryConfig;
    // An ordinary field would carry its value here; a live node carries a
    // reference, which is what makes the next read observable at all.
    expect((resolved.mode as { get(): string }).get()).toBe("audit");
    expect(snapshotSafetyGateConfig(resolved)).toMatchObject({
      mode: "audit",
      output: { mode: "observe" },
    });
  });

  it("reads the value behind a reference on every snapshot", () => {
    const mode = liveNode<GateMode>("warn");
    const entry: ModelSafetyGateEntryConfig = { mode };
    expect(snapshotSafetyGateConfig(entry).mode).toBe("warn");
    mode.commit("enforce");
    expect(snapshotSafetyGateConfig(entry).mode).toBe("enforce");
  });

  it("resolves the composition entry while no user layer exists", async () => {
    const ctx = new Context();
    await ctx.plugin(ModelSafetyGate, { mode: "audit", enabled: true });
    expect(ctx.safetyGate.config.mode).toBe("audit");
    expect(ctx.safetyGate.inspect().mode).toBe("audit");
  });

  it("binds the card to the profile entry id, which is the namespace", () => {
    // Under `0.1.7` the namespace of a configuration form is the entry id the
    // profile patch declares, so the two literals are one fact, not two.
    expect(SAFETY_GATE_SETTINGS_NAMESPACE).toBe("dsh-model-safety-gate");
  });
});
