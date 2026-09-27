/**
 * Remote failure codes of the persona editor.
 *
 * The codes are declared beside the point that throws them (the harness's own
 * convention: {@link RemoteErrorDetailsMap} is merge-extensible), so a client
 * discriminates by `code`, never by message text.
 * @module host/errors
 */

import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    /** The roster does not know this preset id. */
    "preset-persona/not-found": { agentPreset: string };
    /** A draft this editor would produce is refused before it is used. */
    "preset-persona/invalid": { agentPreset: string; reason: string };
    /** The deployment does not mount a service this editor needs. */
    "preset-persona/unavailable": { service: string };
  }
}

/**
 * The preset is not in the roster.
 *
 * `hostReason` is the registry's own words for the refusal. The page answers a
 * single not-found code whatever the registry threw, so without the reason kept
 * here it would be lost before the service logs the failure.
 */
export function notFound(
  agentPreset: string,
  hostReason = "",
): RemoteError<"preset-persona/not-found"> {
  return new RemoteError(
    "preset-persona/not-found",
    hostReason === ""
      ? `preset-persona-editor: preset "${agentPreset}" is not in the roster`
      : `preset-persona-editor: preset "${agentPreset}" is not in the roster — the registry answered: ${hostReason}`,
    { agentPreset },
  );
}

/** The request is refused before anything is written. */
export function invalid(
  agentPreset: string,
  reason: string,
): RemoteError<"preset-persona/invalid"> {
  return new RemoteError(
    "preset-persona/invalid",
    `preset-persona-editor: ${reason}`,
    { agentPreset, reason },
  );
}

/** A host service this editor reads is not mounted in this deployment. */
export function unavailable(
  service: string,
): RemoteError<"preset-persona/unavailable"> {
  return new RemoteError(
    "preset-persona/unavailable",
    `preset-persona-editor: the deployment mounts no "${service}" service`,
    { service },
  );
}
