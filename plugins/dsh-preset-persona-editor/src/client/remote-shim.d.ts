/**
 * The generated Remote artifact ships as `lib/typert.remote-client.js` after a
 * build; this shim keeps the self-import typed on a clean tree and in editors
 * that have not run `generate-typert` yet.
 */
declare module "@yadsh/dsh-preset-persona-editor/remote" {
  import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";

  const contribution: TypertRemoteContribution;
  export default contribution;
}
