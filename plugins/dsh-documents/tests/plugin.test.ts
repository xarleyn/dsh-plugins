/**
 * The plugin entry: what it registers, when it registers nothing, and the
 * invariants the card and the deployment manifest depend on.
 */

import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, test } from "vitest";

import DocumentsPlugin, {
  DOCUMENTS_SETTINGS_NAMESPACE,
  name as pluginName,
} from "../src/index.js";
import { ConfigSchema } from "../src/schema.js";
import { DOCUMENT_TOOL_NAMES } from "../src/shared/settings.js";
import {
  DOCUMENT_TOOL_NAMES as REGISTERED_TOOL_NAMES,
  DOCUMENT_COMPARISON_TOOL_NAMES,
} from "../src/documents/tools/index.js";
import {
  DEFAULT_DOCUMENTS_CONFIG,
  applyDocumentsEnvOverrides,
} from "../src/documents/config.js";
import type { DocumentsConfig } from "../src/documents/config.js";
import { DOCUMENT_COMPARISON_TOOL_NAMES as CARD_COMPARISON_TOOL_NAMES } from "../src/shared/settings.js";

interface Stub {
  readonly ctx: Context;
  readonly registered: string[];
  /** Plugin mounts the entry performed, by the config each was given. */
  readonly mounted: { readonly providerName?: string }[];
  /** Services the plugin published for its Host siblings, by name. */
  readonly provided: Map<string, unknown>;
}

function stubContext(): Stub {
  const registered: string[] = [];
  const mounted: { readonly providerName?: string }[] = [];
  const provided = new Map<string, unknown>();
  const ctx = {
    logger: {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => undefined,
    },
    tools: {
      register: (definition: { name: string }) => {
        registered.push(definition.name);
        return () => {};
      },
    },
    effect: () => {},
    inject: () => {},
    get: () => undefined,
    provide: (serviceName: string, value: unknown) => {
      provided.set(serviceName, value);
      return () => {
        provided.delete(serviceName);
      };
    },
    plugin: (_plugin: unknown, config: unknown) => {
      mounted.push((config ?? {}) as { readonly providerName?: string });
    },
  } as unknown as Context;
  return { ctx, registered, mounted, provided };
}

function plugin(config: DocumentsConfig = {}): {
  registered: string[];
  mounted: { readonly providerName?: string }[];
  provided: Map<string, unknown>;
  instance: DocumentsPlugin;
} {
  const { ctx, registered, mounted, provided } = stubContext();
  return {
    registered,
    mounted,
    provided,
    instance: new DocumentsPlugin(ctx, config),
  };
}

describe("documents plugin", () => {
  test("identifies itself by id and settings namespace", () => {
    expect(pluginName).toBe("documents");
    expect(DOCUMENTS_SETTINGS_NAMESPACE).toBe("documents");
    // The patch row the plugin manager inserts names this id.
    expect(DocumentsPlugin.Config).toBe(ConfigSchema);
  });

  test("registers the five document tools and the comparison pair", () => {
    const { registered } = plugin();
    expect(registered).toEqual([
      ...REGISTERED_TOOL_NAMES,
      ...DOCUMENT_COMPARISON_TOOL_NAMES,
    ]);
    expect(registered).toEqual([
      "document_create",
      "document_to_markdown",
      "document_from_url",
      "document_convert",
      "document_inspect",
      "document_compare",
      "document_diff_read",
    ]);
    // The comparison tools exist only while the feature is on (§31).
    const off = plugin({ comparison: { enabled: false } });
    expect(off.registered).toEqual([...REGISTERED_TOOL_NAMES]);
  });

  test("the card's inventory cannot drift from the registered tools", () => {
    // The card renders its own copy of these names (it must not import the
    // tools module), so a mismatch would misdescribe the plugin in the UI.
    expect([...DOCUMENT_TOOL_NAMES]).toEqual([...REGISTERED_TOOL_NAMES]);
    expect([...CARD_COMPARISON_TOOL_NAMES]).toEqual([
      ...DOCUMENT_COMPARISON_TOOL_NAMES,
    ]);
  });

  test("registers nothing at all while the pipeline is disabled", () => {
    const { registered, mounted } = plugin({ enabled: false });
    expect(registered).toEqual([]);
    expect(mounted).toEqual([]);
  });

  test("publishes the runtime face a sibling host plugin converts through", () => {
    const { provided } = plugin();
    const face = provided.get("documents") as
      Record<string, unknown> | undefined;
    expect(face).toBeDefined();
    // The three operations the panel needs, each bound to the live runtime
    // rather than to a snapshot of it.
    expect(typeof face?.toMarkdown).toBe("function");
    expect(typeof face?.convert).toBe("function");
    expect(typeof face?.inspect).toBe("function");
  });

  test("publishes nothing while the pipeline is disabled", () => {
    const { provided } = plugin({ enabled: false });
    expect(provided.has("documents")).toBe(false);
  });

  test("mounts the contract-review skill with the comparison it teaches", () => {
    const on = plugin();
    expect(on.mounted.map((config) => config.providerName)).toEqual([
      "documents",
    ]);
    const off = plugin({ comparison: { enabled: false } });
    expect(off.mounted).toEqual([]);
  });

  test("the config it resolves starts from the canonical defaults", () => {
    const { instance } = plugin();
    expect(instance.resolved()).toEqual(DEFAULT_DOCUMENTS_CONFIG);
  });

  test("environment overrides keep the documented DSH_DOCUMENTS_ names", () => {
    const overridden = applyDocumentsEnvOverrides(
      {},
      {
        DSH_DOCUMENTS_ENABLED: "false",
        DSH_DOCUMENTS_STORAGE_ROOT: "D:/shared/documents",
        DSH_DOCUMENTS_DOCLING_BASE_URL: "http://docling.internal:5001",
        DSH_DOCUMENTS_PANDOC_EXECUTABLE: "pandoc-3",
      },
    );
    expect(overridden.enabled).toBe(false);
    expect(overridden.storage?.root).toBe("D:/shared/documents");
    expect(overridden.docling?.baseUrl).toBe("http://docling.internal:5001");
    expect(overridden.pandoc?.executable).toBe("pandoc-3");
    // The QA-era names are gone: a stale deployment must not silently keep
    // pointing at the old prefix.
    const stale = applyDocumentsEnvOverrides(
      {},
      { QA_DOCUMENTS_STORAGE_ROOT: "D:/old" },
    );
    expect(stale.storage?.root).toBeUndefined();
  });
});
