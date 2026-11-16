// Cordis integration fixture. Mount only on a disposable Host with a copy of the
// parent session and its artifacts. The trace and receipts stay in its private mount.
import { readFile, writeFile, appendFile, open } from "node:fs/promises";
import path from "node:path";
import { apply as mountGate } from "@yadsh/dsh-answer-review-gate";

export const name = "answer-review-document-replay";
export function apply(ctx) {
  const directory = process.env.DSH_REVIEW_FIXTURE;
  if (!directory) throw new Error("DSH_REVIEW_FIXTURE is required");
  ctx.inject(
    ["agents", "agentPresets", "attachments", "documents", "domainExperts"],
    (live) => {
      const timer = setTimeout(() => {
        void replay(live, directory).catch((error) =>
          writeFile(
            path.join(directory, "error.txt"),
            String(error.stack ?? error),
          ),
        );
      }, 5000);
      return () => clearTimeout(timer);
    },
  );
}

async function replay(ctx, directory) {
  const lock = await open(path.join(directory, "started"), "wx");
  await lock.close();
  const spec = JSON.parse(
    await readFile(path.join(directory, "case.json"), "utf8"),
  );
  const trace = (entry) =>
    appendFile(
      path.join(directory, "trace.jsonl"),
      JSON.stringify(entry) + "\n",
    );
  const [header, ...all] = (
    await readFile(path.join(directory, "input.jsonl"), "utf8")
  )
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const presets = ctx.get("agentPresets");
  const handle = await ctx.get("agents").resume({
    resumeSessionId: header.id,
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, header.agentPreset);
    },
  });
  const agent = handle.agent;
  const hooks = new Map();
  const receipts = [];
  const face = ctx.get("domainExperts");
  let capture;
  const dispose = mountGate(
    {
      get: (key) =>
        key === "domainExperts"
          ? {
              async reviewExpertBounded(...args) {
                let result;
                if (capture) {
                  for (const { data } of capture.reads) {
                    hooks.get("tools/result")(
                      {
                        name: "read",
                        agent: {
                          id: capture.child.id,
                          session: { header: capture.child },
                        },
                        arguments: { file_path: data.meta.path },
                      },
                      { isError: false, value: data.meta },
                    );
                  }
                  result = capture.result;
                } else result = await face.reviewExpertBounded(...args);
                await trace({
                  kind: capture ? "recorded-expert" : "expert",
                  result,
                });
                return result;
              },
            }
          : key === "documents" && capture
            ? {
                async toMarkdown({ file }) {
                  const record = capture.files.find((f) => f.file === file);
                  if (!record) throw new Error("Missing captured extraction");
                  return {
                    markdownPath: record.read,
                    manifestPath: path.join(
                      path.dirname(record.read),
                      "manifest.json",
                    ),
                  };
                },
              }
            : ctx.get(key),
      on: (event, fn) => {
        hooks.set(event, fn);
        if (event === "tools/result")
          return ctx.on(event, fn, { global: true });
        return () => hooks.delete(event);
      },
      inject: () => undefined,
    },
    spec.config,
  );
  try {
    for (const candidate of spec.candidates) {
      capture = undefined;
      if (candidate.capture) {
        const parseLines = async (file) =>
          (await readFile(path.join(directory, file), "utf8"))
            .trim()
            .split(/\r?\n/u)
            .map((line) => JSON.parse(line));
        const [child, ...events] = await parseLines(candidate.capture.events);
        const result = (await parseLines(candidate.capture.trace)).find(
          (e) => e.result?.result?.childSessionId === child.id,
        )?.result;
        if (!result || child.parentSession !== header.id)
          throw new Error("Wrong captured reviewer");
        const reads = events.filter(
          (e) =>
            e.type === "tool/result" &&
            e.data.message?.isError === false &&
            Array.isArray(e.data.meta?.lines),
        );
        const packet = reads.find((e) =>
          e.data.meta.path.includes("/answer-reviews/"),
        );
        const files = (await readFile(packet.data.meta.path, "utf8"))
          .split(/\r?\n/u)
          .filter((s) => s.startsWith('{"key":'))
          .map((s) => JSON.parse(s));
        capture = { child, reads, result, files };
      }
      const through =
        typeof candidate === "number" ? candidate : candidate.through;
      const events = all.filter((e) => e.seq <= through);
      if (typeof candidate.text === "string") {
        events.push({
          seq: through + 1,
          type: "assistant/message",
          surfaceOp: "append",
          data: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: candidate.text }],
            },
          },
        });
      }
      const nodes = [];
      for (const e of events) {
        if (e.surfaceOp === "append") nodes.push(e.seq);
        else if (e.surfaceOp) {
          const { op, startSeq, endSeq } = e.surfaceOp;
          const start = nodes.indexOf(startSeq),
            end = nodes.indexOf(endSeq);
          if (op !== "replace" || start < 0 || end < start)
            throw new Error("Unexpected fixture surface operation");
          nodes.splice(start, end - start + 1, e.seq);
        }
      }
      const bySeq = new Map(events.map((e) => [e.seq, e]));
      await hooks.get("agent/turn-stopping")({
        agent: {
          id: agent.id,
          ctx: agent.ctx,
          session: {
            header,
            surface: { nodes },
            eventAt: (seq) => bySeq.get(seq),
            snapshotEvents: () => events,
            append: (_type, data) => receipts.push(data.source.receipt),
          },
          steer: (message) => {
            void trace({ kind: "steer", message });
          },
        },
        turn: 1,
        signal: globalThis.AbortSignal.timeout(
          spec.config.reviewer.roundTimeoutMs + 10000,
        ),
      });
    }
    await writeFile(
      path.join(directory, "receipts.json"),
      JSON.stringify(receipts, null, 2),
    );
  } finally {
    await dispose();
    await handle.dispose();
  }
}
