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
import { DOCUMENT_TOOL_NAMES as REGISTERED_TOOL_NAMES } from "../src/documents/tools/index.js";
import {
  DEFAULT_DOCUMENTS_CONFIG,
  applyDocumentsEnvOverrides,
} from "../src/documents/config.js";
import type { DocumentsConfig } from "../src/documents/config.js";

interface Stub {
  readonly ctx: Context;
  readonly registered: string[];
}

function stubContext(): Stub {
  const registered: string[] = [];
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
  } as unknown as Context;
  return { ctx, registered };
}

function plugin(config: DocumentsConfig = {}): {
  registered: string[];
  instance: DocumentsPlugin;
} {
  const { ctx, registered } = stubContext();
  return { registered, instance: new DocumentsPlugin(ctx, config) };
}

describe("documents plugin", () => {
  test("identifies itself by id and settings namespace", () => {
    expect(pluginName).toBe("documents");
    expect(DOCUMENTS_SETTINGS_NAMESPACE).toBe("documents");
    // The patch row the plugin manager inserts names this id.
    expect(DocumentsPlugin.Config).toBe(ConfigSchema);
  });

  test("registers exactly the five document tools", () => {
    const { registered } = plugin();
    expect(registered).toEqual([...REGISTERED_TOOL_NAMES]);
    expect(registered).toEqual([
      "document_create",
      "document_to_markdown",
      "document_from_url",
      "document_convert",
      "document_inspect",
    ]);
  });

  test("the card's inventory cannot drift from the registered tools", () => {
    // The card renders its own copy of these names (it must not import the
    // tools module), so a mismatch would misdescribe the plugin in the UI.
    expect([...DOCUMENT_TOOL_NAMES]).toEqual([...REGISTERED_TOOL_NAMES]);
  });

  test("registers nothing at all while the pipeline is disabled", () => {
    const { registered } = plugin({ enabled: false });
    expect(registered).toEqual([]);
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
