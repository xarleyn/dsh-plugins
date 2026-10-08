import { COPY_MANUAL_HINT, COPY_MANUAL_REASON } from "../clipboard.js";

/**
 * What a copy affordance shows where copying cannot happen: a sentence naming
 * the dead end, in place of a button that would only look like it worked.
 */
export function CopyHint({ testId }: { readonly testId: string }) {
  return (
    <span
      className="dsh-qa-copy-hint"
      data-testid={testId}
      title={COPY_MANUAL_REASON}
    >
      {COPY_MANUAL_HINT}
    </span>
  );
}
