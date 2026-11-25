import { FilesystemCasStore } from "../../src/cas/filesystem-store.js";

// Each worker has its own module cache and starts writing on the parent's signal.
const [root, codec] = process.argv.slice(2);
if (!root || (codec !== "gzip" && codec !== "none"))
  throw new Error("invalid worker arguments");
const store = new FilesystemCasStore(root, { compression: codec });
process.once("message", async () => {
  const result = await store.put({
    payload: Buffer.from("shared text ".repeat(4000)),
    kind: "text",
    mediaType: "text/plain",
    encoding: "utf8",
    firstTool: codec,
  });
  process.send?.(result);
  process.disconnect?.();
});
process.send?.("ready");
