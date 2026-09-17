/**
 * Public `ctx.presetPersonaEditor` service: the host half of the agent-preset
 * persona editor.
 *
 * The service owns no state of its own. Every read goes to the preset roster
 * and the composition files the roster points at; every write goes back into
 * the preset's own `agent.cordis.yml` and nowhere else. That is the whole
 * design: the persona's source of truth is the preset composition, so the
 * feature keeps working — and keeps its meaning — with this plugin uninstalled.
 *
 * Wire surface (`presetPersonaEditor` namespace):
 *  - `list` — the roster with each preset's persona state;
 *  - `read` — one preset as an editable document, revision included;
 *  - `save` — write the four persona values through a revision check;
 *  - `reset` — drop the persona row so the deployment's persona applies again;
 *  - `copy` — duplicate a preset into the writable root for editing.
 * @module host/service
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the `ctx.agentPresets` and `ctx.systemPrompt` service merges.
import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import z from "@deepseek-ai/schemastery";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLoggerLike,
} from "@yadsh/dsh-plugin-log";

import type {
  PersonaCatalog,
  PersonaDocument,
  PersonaDraft,
  PersonaWriteReceipt,
} from "../types.js";
import {
  readCatalog,
  readDocument,
  type PresetRosterFace,
  type SystemPromptFace,
} from "./preset-reader.js";
import {
  copyPreset as duplicatePreset,
  resetPersona as dropPersonaRow,
  savePersona as writePersona,
} from "./preset-writer.js";
import { DEFAULT_LIMITS, type PersonaLimits } from "./validation.js";

/** Plugin configuration: what this deployment lets the editor write. */
export interface Config {
  /** Whether a `complete` persona may be written at all. */
  allowComplete?: boolean;
  /** Byte ceiling for prefix plus suffix. */
  maxPersonaBytes?: number;
}

/** The plugin's configuration schema, shared by the Cordis loader. */
export const ConfigSchema: z<Config> = z.object({
  allowComplete: z.boolean().default(true),
  maxPersonaBytes: z.number().default(DEFAULT_LIMITS.maxPersonaBytes),
});

/** Overridable internals for tests. */
export interface PresetPersonaEditorDeps {
  readonly logger?: PluginLoggerLike;
}

/** The default byte ceiling, exported for the tests and the plugin manifest. */
export const DEFAULT_MAX_PERSONA_BYTES = DEFAULT_LIMITS.maxPersonaBytes;

export class PresetPersonaEditor extends TypertRemoteService {
  static inject = ["agentPresets", "systemPrompt"];
  static Config = ConfigSchema;

  private readonly logger: PluginLoggerLike;
  private readonly limits: PersonaLimits;

  constructor(
    ctx: Context,
    config: Config = {},
    deps: PresetPersonaEditorDeps = {},
  ) {
    // The Typert generator reads these as literals: the Cordis service key and
    // the wire namespace must be spelled here, not aliased through a constant.
    super(ctx, "presetPersonaEditor", { namespace: "presetPersonaEditor" });
    this.limits = {
      allowComplete: config.allowComplete ?? DEFAULT_LIMITS.allowComplete,
      maxPersonaBytes: config.maxPersonaBytes ?? DEFAULT_LIMITS.maxPersonaBytes,
    };
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

  /** One preset opened for editing. */
  @Remote("read")
  async readPersona(agentPreset: string): Promise<PersonaDocument> {
    return await readDocument(this.roster, this.prompts, agentPreset);
  }

  /** Write the persona values into the preset's own composition. */
  @Remote("save")
  async savePersona(
    agentPreset: string,
    persona: PersonaDraft,
    expectedRevision: string,
  ): Promise<PersonaWriteReceipt> {
    const receipt = await writePersona(
      { roster: this.roster, limits: this.limits },
      agentPreset,
      persona,
      expectedRevision,
    );
    this.logger.info("preset-persona.saved", {
      agentPreset,
      complete: persona?.complete === true,
      prefixBytes: Buffer.byteLength(persona?.prefix ?? "", "utf8"),
      suffixBytes: Buffer.byteLength(persona?.suffix ?? "", "utf8"),
    });
    return receipt;
  }

  /** Drop the preset's persona row, so the deployment's persona applies again. */
  @Remote("reset")
  async resetPersona(
    agentPreset: string,
    expectedRevision: string,
  ): Promise<PersonaWriteReceipt> {
    const receipt = await dropPersonaRow(
      { roster: this.roster, limits: this.limits },
      agentPreset,
      expectedRevision,
    );
    this.logger.info("preset-persona.reset", { agentPreset });
    return receipt;
  }

  /** Duplicate a preset into the writable root and open the copy. */
  @Remote("copy")
  async copyPreset(
    from: string,
    id: string,
    name: string,
  ): Promise<PersonaDocument> {
    await duplicatePreset(this.roster, from, id, name);
    this.logger.info("preset-persona.copied", { from, agentPreset: id });
    // The copy is opened by id, so the caller gets one document back rather
    // than a second round trip through a roster that may not have settled yet.
    return await readDocument(this.roster, this.prompts, id);
  }
}

export default PresetPersonaEditor;

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Browse and edit agent-preset personas through the composition files. */
    presetPersonaEditor: PresetPersonaEditor;
  }
}
