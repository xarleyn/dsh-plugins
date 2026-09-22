/**
 * The documentation version grammar, shared by the Host and the browser half.
 *
 * This module must stay dependency-free: the settings card bundle inlines the
 * resolver that validates a configured default version, and a browser build
 * must not pull the QA tool runtime — or the Node builtins it reads files with
 * — into the page just to learn what a version looks like.
 */

/** `3.8`, `v2`, `2024.1`: the directory segment a corpus names an edition with. */
const VERSION_SEGMENT = /^v?\d+(?:\.\d+)*$/iu;

/**
 * Whether a path segment — or a configured default version — is a documentation
 * version. A default the corpus can never match is refused where it is written
 * rather than answered with an empty search.
 */
export function isDocumentationVersion(value: string): boolean {
  return VERSION_SEGMENT.test(value.trim());
}
