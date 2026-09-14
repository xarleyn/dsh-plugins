/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * Session-start profile delivery. Callers decide *whether* to run it — this
 * module never checks the injection configuration itself.
 */

import type { Agent } from "@deepseek-ai/dsh-agent";

import type { OpenVikingRuntime } from "./runtime.js";

/**
 * Deliver the stored user profile into an agent that has not started working
 * yet.
 *
 * @returns whether a profile message was actually injected. `false` covers the
 *   ordinary cases: the runtime is not ready, another contributor already
 *   claimed the profile, or the agent left `idle` before the profile arrived —
 *   in which case `agent/pre-step` owns delivery instead.
 */
export async function injectStartupProfile(
  agent: Agent,
  runtime: OpenVikingRuntime,
): Promise<boolean> {
  await runtime.initialize(agent);
  if (agent.status !== "idle") return false;
  const profile = await runtime.profileMessage(agent);
  if (!profile) return false;
  agent.inject(profile);
  return true;
}
