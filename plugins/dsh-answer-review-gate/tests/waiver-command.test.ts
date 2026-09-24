import { describe, expect, it } from "vitest";

import { resolveAnswerReviewGateConfig } from "../src/config.js";
import {
  registerReviewWaiverCommand,
  type ReviewWaiverCommandInvocation,
  type ReviewWaiverCommandRegistry,
} from "../src/waiver.js";

type Definition = Parameters<ReviewWaiverCommandRegistry["register"]>[0];

function registered(config = resolveAnswerReviewGateConfig({})): {
  readonly definition: Definition;
  readonly disposed: () => boolean;
} {
  let definition: Definition | undefined;
  let wasDisposed = false;
  const dispose = registerReviewWaiverCommand(
    {
      register(value) {
        definition = value;
        return () => {
          wasDisposed = true;
        };
      },
    },
    () => config,
  );
  expect(definition).toBeDefined();
  dispose();
  return {
    definition: definition!,
    disposed: () => wasDisposed,
  };
}

function invocation(overrides: Partial<ReviewWaiverCommandInvocation> = {}): {
  readonly value: ReviewWaiverCommandInvocation;
  readonly followups: unknown[];
  readonly events: { readonly type: string; readonly data: unknown }[];
} {
  const followups: unknown[] = [];
  const events: { readonly type: string; readonly data: unknown }[] = [];
  const session = { snapshotEvents: () => events };
  return {
    value: {
      commandId: "cmd-waiver-1",
      rawInput: "  explain the result  ",
      attachments: [],
      signal: new AbortController().signal,
      agent: {
        session,
        followup: (message) => {
          followups.push(message);
          events.push({
            type: "agent/inbox/spliced",
            data: {
              target: "next-turn",
              start: 0,
              inserted: [message],
            },
          });
        },
      },
      ...overrides,
    },
    followups,
    events,
  };
}

describe("/no-review command", () => {
  it("registers a private-input command that accepts durable attachments", () => {
    const command = registered();
    expect(command.definition).toMatchObject({
      name: "no-review",
      input: { hint: "<request>", attachments: true },
      recordInput: false,
    });
    expect(command.disposed()).toBe(true);
  });

  it("submits one ordinary user request and links its inbox admission", () => {
    const { definition } = registered();
    const image = {
      type: "image",
      attachment: {
        attachmentId: "sha256-demo" as never,
        mediaType: "image/png",
        bytes: 1,
        width: 1,
        height: 1,
      },
    } as const;
    const call = invocation({ attachments: [image] });

    expect(definition.handler(call.value)).toEqual({
      kind: "success",
      text: "Review skipped for this request. The answer will not be independently verified.",
      sourceEventSeq: 0,
    });
    expect(call.followups).toHaveLength(1);
    expect(call.followups[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "explain the result" }, image],
      source: { kind: "user" },
    });
  });

  it("rejects empty, cancelled and policy-blocked requests without followup", () => {
    const cases = [
      {
        definition: registered().definition,
        call: invocation({ rawInput: "   " }),
        text: "Usage: /no-review <request>",
      },
      {
        definition: registered().definition,
        call: (() => {
          const controller = new AbortController();
          controller.abort();
          return invocation({ signal: controller.signal });
        })(),
        text: "The no-review request was cancelled.",
      },
      {
        definition: registered(
          resolveAnswerReviewGateConfig({ waiver: { enabled: false } }),
        ).definition,
        call: invocation(),
        text: "Review waivers are disabled by the deployment policy.",
      },
      {
        definition: registered(
          resolveAnswerReviewGateConfig({ failMode: "closed" }),
        ).definition,
        call: invocation(),
        text: "Review waivers are not allowed while the gate uses closed failure mode.",
      },
    ];

    for (const item of cases) {
      expect(item.definition.handler(item.call.value)).toEqual({
        kind: "error",
        text: item.text,
      });
      expect(item.call.followups).toHaveLength(0);
    }
  });

  it("allows a deployment to explicitly permit waivers in closed mode", () => {
    const { definition } = registered(
      resolveAnswerReviewGateConfig({
        failMode: "closed",
        waiver: { allowedInClosedMode: true },
      }),
    );
    const call = invocation();
    expect(definition.handler(call.value).kind).toBe("success");
    expect(call.followups).toHaveLength(1);
  });
});
