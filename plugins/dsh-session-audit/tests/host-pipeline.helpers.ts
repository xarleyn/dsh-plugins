/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { afterEach, beforeEach } from "vitest";
import { removeRoot, temporaryRoot } from "./helpers/fixtures.js";

export let root: string;

/** Temporary directories beside {@link root} — deliberately outside it. */
const siblings: string[] = [];

/**
 * A temporary directory the audit root does not contain, for the cases where a
 * link has to point somewhere the reader must refuse.
 */
export async function siblingRoot(): Promise<string> {
  const created = await temporaryRoot();
  siblings.push(created);
  return created;
}

beforeEach(async () => {
  root = await temporaryRoot();
});

afterEach(async () => {
  await removeRoot(root);
  for (const path of siblings.splice(0)) await removeRoot(path);
});
