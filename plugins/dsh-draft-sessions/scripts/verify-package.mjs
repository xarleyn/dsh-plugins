import { Context } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import draftSessionsRemote from "../lib/remote.js";
import { DraftSessionsService } from "../lib/index.js";

const expected = ["list", "create", "update", "delete", "rebind"];
const context = new Context();
const service = new DraftSessionsService(context, {
  storagePath: "./.package-smoke-drafts.json",
});
const hostMethods = remoteMethods(service).map(({ method }) => method);
const clientMethods = draftSessionsRemote.descriptors.map(
  ({ method }) => method,
);

if (JSON.stringify(hostMethods) !== JSON.stringify(expected)) {
  throw new Error(`built Host Remote methods differ: ${hostMethods.join(",")}`);
}
if (JSON.stringify(clientMethods) !== JSON.stringify(expected)) {
  throw new Error(
    `built Client Remote methods differ: ${clientMethods.join(",")}`,
  );
}
