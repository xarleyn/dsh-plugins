import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace/types";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import type { QaSessions, QaSessionsApi } from "./types.js";

/**
 * Create one Host session and pin the configured preset and model onto the
 * still-blank session. The creation wire takes no preset, so
 * agentPresets/select recomposes the agent and durably logs
 * `agent-preset/selected`, which the client projection replays. The session
 * is addressed only here — no prompt can run before the caller attests the
 * composed preset.
 */
export async function createQaSession(args: {
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  readonly config: ResolvedQaSurfaceConfig;
}): Promise<string> {
  const { sessions, api, config } = args;
  const created = await sessions.create({
    ...(config.session.workspaceId !== null
      ? { workspaceId: config.session.workspaceId as WorkspaceId }
      : config.session.cwd !== null
        ? { cwd: config.session.cwd }
        : {}),
  });
  const id = String(created);
  if (config.session.agentPreset !== null) {
    const selectedPreset = await api.selectAgentPreset(
      id as SessionId,
      config.session.agentPreset,
    );
    if (!selectedPreset.ok) {
      throw new Error(selectedPreset.error.code);
    }
  }
  if (config.session.provider !== null && config.session.model !== null) {
    const selected = await api.selectModel({
      sessionId: id as SessionId,
      provider: config.session.provider,
      model: config.session.model,
      ...(config.session.reasoningEffort === null
        ? {}
        : { reasoningEffort: config.session.reasoningEffort }),
    });
    if (!selected.ok) throw new Error(selected.error.code);
  }
  return id;
}
