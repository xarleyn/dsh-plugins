import { readFile } from "node:fs/promises";

const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);
const draftRegistration = client.indexOf('id: "dsh-draft-sessions"');

if (draftRegistration < 0) {
  throw new Error("client bundle is missing the draft-sessions factory");
}
if (client.includes("dsh-client-ui-workspace")) {
  throw new Error(
    "client bundle must not embed or require a workspace-browser implementation",
  );
}
if (!client.includes('"sidebar.footer.action"')) {
  throw new Error("client bundle is missing the stock sidebar fallback");
}
if (!client.includes("__dshNativeTabs")) {
  throw new Error("client bundle is missing native-tab cooperation");
}
if (client.includes('register({ name: "sidebar.workspaces"')) {
  throw new Error("client bundle must not occupy the workspace-browser slot");
}
if (client.includes("upstream occupant")) {
  throw new Error("client bundle retains the obsolete occupant warning path");
}
