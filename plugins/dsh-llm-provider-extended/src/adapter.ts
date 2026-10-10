import { PiAiAdapter, type PiAiAdapterOptions } from "./upstream/adapter.js";
import type {
  GenerateOptions,
  StreamChunk,
  LlmModelInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
} from "@deepseek-ai/dsh-llm";
import type {
  PiAiProviderProfile,
  ResolvedPiAiProviderProfile,
} from "./upstream/config.js";
import { streamSystemOne, systemModelInfo } from "./systemone.js";

/** Chat routes retain upstream behavior; native decisions use a separate transport. */
export class ExtendedAdapter extends PiAiAdapter {
  constructor(private readonly hooks: PiAiAdapterOptions) {
    super(hooks);
  }
  private decision(provider: string): ResolvedPiAiProviderProfile | undefined {
    const profile = this.hooks.profiles().get(provider);
    return profile?.api === "systemone" ? profile : undefined;
  }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const profile = this.decision(provider);
    return profile
      ? Promise.resolve(
          ((profile as PiAiProviderProfile).models ?? []).map((m) =>
            systemModelInfo(profile, m.id),
          ),
        )
      : super.listModels(provider);
  }
  override resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const profile = this.decision(provider);
    return profile
      ? Promise.resolve(systemModelInfo(profile, model))
      : super.resolveModel(provider, model, signal);
  }
  override prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const profile = this.decision(provider);
    if (!profile) return super.prepareCall(provider, model, signal);
    return Promise.resolve({
      model: systemModelInfo(profile, model),
      stream: (options) =>
        streamSystemOne(options, profile, () =>
          this.hooks.resolveApiKey(provider, profile),
        ),
    });
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const profile = this.decision(options.provider);
    return profile
      ? streamSystemOne(options, profile, () =>
          this.hooks.resolveApiKey(options.provider, profile),
        )
      : super.stream(options);
  }
}
