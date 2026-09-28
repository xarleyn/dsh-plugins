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
    /** The validation rules refuse a persona draft or a section list. */
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

/**
 * The validation rules refuse a persona draft or a section list.
 *
 * Decision D2 took the write operations out of this namespace, so nothing
 * inside the plugin raises it any more: `src/host/validation.ts` stays the
 * package's exported library for the write path `docs/DSH-0.1.7-MIGRATION.md`
 * §10 describes, and the browser keeps its branch on this code so that whenever
 * those rules do run, the refusal arrives as its reason rather than as a bare
 * failure.
 */
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
