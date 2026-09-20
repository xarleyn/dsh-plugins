import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";

/** One host-injected settlement context node, labeled like the host does. */
export const settlementNode = (seq: number, text: string): ConversationNode =>
  ({
    kind: "context",
    seq,
    time: seq * 10,
    content: [{ type: "text", text }],
    source: {},
    provenance: { role: "inject", label: "subagent-settled" },
    form: null,
  }) as ConversationNode;
