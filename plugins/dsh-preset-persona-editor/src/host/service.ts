/**
 * Public `ctx.presetPersonaEditor` service: the host half of the agent-preset
 * persona reader.
 *
 * The service owns no state of its own. Every read goes to the preset roster
 * and the composition the roster points at. It writes nothing: the Host has no
 * durable preset-authoring path since `0.1.7-rc.2`, so this page reports what a
 * preset composes rather than changing it (decision D2 of
 * `docs/DSH-0.1.7-MIGRATION.md` §10).
 *
 * Wire surface (`presetPersonaEditor` namespace):
 *  - `list` — the roster with each preset's persona state;
 *  - `read` — one preset as a document, its composition text included.
 * @module host/service
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the `ctx.agentPresets` and `ctx.systemPrompt` service merges.
import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLoggerLike,
} from "@yadsh/dsh-plugin-log";

import type { PersonaCatalog, PersonaDocument } from "../types.js";
import {
  readCatalog,
  readDocument,
  type PresetRosterFace,
  type SystemPromptFace,
} from "./preset-reader.js";
import { reasonOf } from "./validation.js";

/** Overridable internals for tests. */
export interface PresetPersonaEditorDeps {
  readonly logger?: PluginLoggerLike;
}

export class PresetPersonaEditor extends TypertRemoteService {
  static inject = ["agentPresets", "systemPrompt"];

  private readonly logger: PluginLoggerLike;

  constructor(ctx: Context, deps: PresetPersonaEditorDeps = {}) {
    // The Typert generator reads these as literals: the Cordis service key and
    // the wire namespace must be spelled here, not aliased through a constant.
    super(ctx, "presetPersonaEditor", { namespace: "presetPersonaEditor" });
    this.logger =
      deps.logger ??
      (getPluginLogger({
        pluginId: "dsh-preset-persona-editor",
        console: "warn",
        consoleSink: createHostLoggerSink(
          ctx.logger as unknown as Context["logger"],
        ),
      }) as PluginLoggerLike);
  }

  /** The roster this editor reads presets from. */
  private get roster(): PresetRosterFace {
    return this.ctx.agentPresets;
  }

  /** The prompt service whose order table places the persona sections. */
  private get prompts(): SystemPromptFace | undefined {
    return this.ctx.systemPrompt;
  }

  /** The roster with each preset's persona state. */
  @Remote("list")
  async listPersonas(): Promise<PersonaCatalog> {
    return await readCatalog(this.roster);
  }

  /** One preset as a document: its persona, its sections, its composition. */
  @Remote("read")
  async readPersona(agentPreset: string): Promise<PersonaDocument> {
    try {
      return await readDocument(this.roster, this.prompts, agentPreset);
    } catch (cause) {
      // The reader answers its own not-found code, which is what the page
      // branches on; the Host's reason for refusing the id would otherwise be
      // lost with no trace in the deployment log.
      this.logger.warn("preset-persona.read-refused", {
        agentPreset,
        reason: reasonOf(cause),
      });
      throw cause;
    }
  }
}

export default PresetPersonaEditor;

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Browse an agent preset's persona through the composition it composes from. */
    presetPersonaEditor: PresetPersonaEditor;
  }
}
