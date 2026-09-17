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
    /** The preset belongs to the deployment and cannot be rewritten. */
    "preset-persona/read-only": { agentPreset: string; reason: string };
    /** The composition changed on disk since the editor read it. */
    "preset-persona/conflict": {
      agentPreset: string;
      expectedRevision: string;
      actualRevision: string;
    };
    /** The request would not produce an editable composition. */
    "preset-persona/invalid": { agentPreset: string; reason: string };
    /** The deployment does not mount a service this editor needs. */
    "preset-persona/unavailable": { service: string };
  }
}

/** The preset is not in the roster. */
export function notFound(
  agentPreset: string,
): RemoteError<"preset-persona/not-found"> {
  return new RemoteError(
    "preset-persona/not-found",
    `preset-persona-editor: preset "${agentPreset}" is not in the roster`,
    { agentPreset },
  );
}

/** The preset ships with the deployment (or sits outside the writable root). */
export function readOnly(
  agentPreset: string,
  reason: string,
): RemoteError<"preset-persona/read-only"> {
  return new RemoteError(
    "preset-persona/read-only",
    `preset-persona-editor: preset "${agentPreset}" cannot be written: ${reason}`,
    { agentPreset, reason },
  );
}

/** The file changed between the read and the write. */
export function conflict(
  agentPreset: string,
  expectedRevision: string,
  actualRevision: string,
): RemoteError<"preset-persona/conflict"> {
  return new RemoteError(
    "preset-persona/conflict",
    `preset-persona-editor: preset "${agentPreset}" was modified externally; reload before saving`,
    { agentPreset, expectedRevision, actualRevision },
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
