// Use the built plugin's routing, prompt boundaries and output validation in the benchmark.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolveToolOffloadConfig } from "../lib/config.js";
import { inspectResult } from "../lib/routing/inspect-result.js";
import { decideRoute } from "../lib/routing/policy.js";
import { BUNDLED_PROMPT_PROFILES } from "../lib/prompts/profiles.js";
import { buildWorkerPrompt } from "../lib/worker/payload.js";
import { validateWorkerOutput } from "../lib/worker/validate.js";

const input = JSON.parse(readFileSync(0, "utf8"));
const config = resolveToolOffloadConfig({
  routing: {
    allow: ["read", "grep", "read_log"],
    rules: [{ match: { tools: ["read_log"] }, prompt: "logs" }],
  },
});
if (input.operation === "validate") {
  console.log(
    JSON.stringify(
      validateWorkerOutput(input.text, input.bytes, config.validation),
    ),
  );
} else {
  const started = performance.now();
  const candidate = inspectResult(
    { name: input.tool, arguments: {} },
    { content: [{ type: "text", text: input.text }] },
  );
  const route = decideRoute(candidate, config);
  const routeMs = performance.now() - started;
  // A mapper can receive a short final slice. Its profile is the original tool's.
  const profile = {
    read: "code-reader",
    grep: "search-results",
    read_log: "logs",
  }[input.tool];
  const job =
    input.operation === "reduce"
      ? "Merge the ordered extracts. Preserve every distinct requested item with its exact citation and quote. Omit empty extracts."
      : BUNDLED_PROMPT_PROFILES[route.prompt ?? profile];
  const prompt = buildWorkerPrompt({
    candidate,
    parentTask: input.task,
    profileJob: job,
  });
  console.log(JSON.stringify({ route, routeMs, prompt }));
}
