/** The structural part of a Host post-execute decision used by content processors. */
export interface ContentDecision<Content> {
  readonly kind: string;
  readonly value?: unknown;
  readonly content?: Content;
}

export type EffectivePostExecuteContent<
  Content,
  Decision extends ContentDecision<Content> = ContentDecision<Content>,
> =
  | { readonly kind: "blocked" | "value-replacement" }
  | {
      readonly kind: "content";
      /** The original decision narrowed to the rendered-content branch. */
      readonly decision: Decision & {
        readonly kind: "accept";
        readonly value?: undefined;
      };
      readonly content: Content;
      /** A downstream projection takes precedence over the original value. */
      readonly replaced: boolean;
    };

/**
 * Resolve content only after awaiting the downstream post-execute decision.
 * A replacement value still needs the Host's renderer and must pass through
 * unchanged. Consumers changing content must spread the accepted decision to
 * preserve its other fields, including additional contexts.
 *
 * This is structural so plugins can use their pinned Host types without this
 * package depending on a particular tools/LLM package version.
 */
export function resolvePostExecuteContent<
  Content,
  Decision extends ContentDecision<Content>,
>(
  decision: Decision,
  originalContent: Content,
): EffectivePostExecuteContent<Content, Decision> {
  if (decision.kind !== "accept") return { kind: "blocked" };
  if (decision.value !== undefined) return { kind: "value-replacement" };
  return {
    kind: "content",
    decision: decision as Decision & {
      readonly kind: "accept";
      readonly value?: undefined;
    },
    content: decision.content ?? originalContent,
    replaced: decision.content !== undefined,
  };
}
