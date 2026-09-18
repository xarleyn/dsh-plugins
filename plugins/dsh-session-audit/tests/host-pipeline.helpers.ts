/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { afterEach, beforeEach } from "vitest";
import { removeRoot, temporaryRoot } from "./helpers/fixtures.js";

export let root: string;

beforeEach(async () => {
  root = await temporaryRoot();
});

afterEach(async () => {
  await removeRoot(root);
});
