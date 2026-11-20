import type { QaModelCatalogEntry, QaModelPair } from "../types.js";

export function qaModelKey({
  provider,
  model,
  reasoningEffort,
}: QaModelPair): string {
  return JSON.stringify(
    reasoningEffort === undefined
      ? [provider, model]
      : [provider, model, reasoningEffort],
  );
}

/** The unpinned choice delegates effort to the Host. Pinned choices carry its exact catalog ID. */
export function catalogModelChoices(
  catalog: readonly QaModelCatalogEntry[],
): { pair: QaModelPair; label: string }[] {
  return catalog.flatMap(({ provider, model, label, reasoningEfforts }) => [
    { pair: { provider, model }, label },
    ...reasoningEfforts.map((reasoningEffort) => ({
      pair: { provider, model, reasoningEffort },
      label: `${label} · ${reasoningEffort}`,
    })),
  ]);
}
