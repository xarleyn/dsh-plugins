import type {
  QaModelCatalogEntry,
  QaModelPair,
  ResolvedQaSurfaceConfig,
} from "../types.js";

/** The layer a resolved pair came from; the journal names it with the pair. */
export type QaModelPolicyLayer = "account" | "subrole" | "deployment";

/**
 * The model policy of one session: the pair its chats open on and the layer
 * that fixed it.
 *
 * That pair is what the fixed-model lockdown holds the session to. It is no
 * longer the deployment's pair, and it is not the model the visitor picked: a
 * role with a pair of its own is served by that pair, while a chat left on a
 * layer some policy has since replaced is outside its policy — exactly as a chat
 * left off the single global pair used to be.
 */
export interface QaSessionModelPolicy {
  readonly pair: QaModelPair | undefined;
  readonly layer: QaModelPolicyLayer | undefined;
}

/** The session fields of the resolved config, as the policy reads them. */
type SessionSlice = ResolvedQaSurfaceConfig["session"];

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalize one configured pair.
 *
 * Provider and model are named together or not at all, because the Host
 * refuses either alone; an empty pair is no pair, so a role that names nothing
 * defers to the layer below it instead of failing the configuration.
 * @param value - the pair as stored, or nothing.
 * @param label - prefix for the refusal, naming the field the operator edited.
 */
export function normalizeModelPair(
  value: QaModelPair | null | undefined,
  label: string,
): QaModelPair | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  const provider = text(value.provider);
  const model = text(value.model);
  if ((provider === "") !== (model === "")) {
    throw new TypeError(`${label}: provider and model must be set together`);
  }
  if (provider === "") return undefined;
  const effort = text(value.reasoningEffort);
  return Object.freeze({
    provider,
    model,
    ...(effort === "" ? {} : { reasoningEffort: effort }),
  });
}

/** The deployment-wide pair, as the policy's last layer. */
export function deploymentModelPair(
  session:
    Pick<SessionSlice, "provider" | "model" | "reasoningEffort"> | undefined,
): QaModelPair | undefined {
  return normalizeModelPair(
    {
      provider: session?.provider ?? "",
      model: session?.model ?? "",
      reasoningEffort: session?.reasoningEffort ?? "",
    },
    "session",
  );
}

/**
 * Fold the named layers into one session policy.
 *
 * The first complete pair wins outright rather than merging field by field: an
 * account that overrides a role says which model it means, and half of a pair
 * from one layer over half of another is a combination no operator wrote.
 * @param layers - the layers in priority order, `undefined` where a layer keeps
 *   no opinion.
 */
export function resolveModelPolicy(
  layers: Partial<Record<QaModelPolicyLayer, QaModelPair | undefined>>,
): QaSessionModelPolicy {
  const order: readonly QaModelPolicyLayer[] = [
    "account",
    "subrole",
    "deployment",
  ];
  const layer = order.find((candidate) => layers[candidate] !== undefined);
  return Object.freeze({
    pair: layer === undefined ? undefined : layers[layer],
    layer,
  });
}

/**
 * The provider, model and reasoning effort a live agent carries, as the
 * lockdown reads them off `agent.options`.
 */
export interface ModelSelectionFacts {
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
}

/**
 * Whether one agent's selection sits inside the session's model policy.
 *
 * A pair that names no effort constrains provider and model only, so a chat
 * that switches effort inside its own model is not mistaken for a move to
 * another policy — which is the reading the single-pair check already had. A
 * policy that names no pair at all constrains nothing: there is no operator
 * decision for the session to have left.
 */
export function modelPolicySatisfied(
  policy: QaSessionModelPolicy,
  selection: ModelSelectionFacts,
): boolean {
  const pair = policy.pair;
  if (pair === undefined) return true;
  return (
    pair.provider === selection.provider &&
    pair.model === selection.model &&
    (pair.reasoningEffort === undefined ||
      pair.reasoningEffort === selection.reasoningEffort)
  );
}

/** The catalog shape this module projects, as the harness reports it. */
export interface HarnessModelCatalog {
  readonly groups: readonly {
    readonly id: string;
    readonly name?: string;
    readonly models: readonly {
      readonly id: string;
      readonly name?: string;
      readonly reasoning?: {
        readonly efforts?: readonly { readonly id: string }[];
      };
    }[];
  }[];
}

/**
 * Project the harness catalog into the pairs the administration surface lists.
 * @param catalog - the host's model catalog.
 */
export function projectModelCatalog(
  catalog: HarnessModelCatalog,
): readonly QaModelCatalogEntry[] {
  return Object.freeze(
    catalog.groups.flatMap((group) =>
      group.models.map((model) => {
        const label = model.name?.trim() ?? "";
        return Object.freeze({
          provider: group.id,
          model: model.id,
          label: label === "" ? model.id : label,
          reasoningEfforts: Object.freeze(
            (model.reasoning?.efforts ?? []).map((effort) => effort.id),
          ),
        });
      }),
    ),
  );
}

/**
 * Refuse a pair the Host cannot serve, in the words an operator reads in the
 * settings surface.
 *
 * Without this a stand accepts a typo and then fails on the first question of
 * every chat that policy opens, which names neither the pair nor where it came
 * from. An empty catalog is not a refusal: a Host whose catalog read failed
 * answers with no entries, and the policy is then checked when the chat starts.
 * @param pair - the pair being saved.
 * @param catalog - the projected catalog, or `undefined` to skip the check.
 */
export function assertModelPairAvailable(
  pair: QaModelPair | undefined,
  catalog: readonly QaModelCatalogEntry[] | undefined,
): void {
  if (pair === undefined || catalog === undefined || catalog.length === 0) {
    return;
  }
  if (
    catalog.some(
      (entry) => entry.provider === pair.provider && entry.model === pair.model,
    )
  ) {
    return;
  }
  const offerors = [
    ...new Set(
      catalog
        .filter((entry) => entry.model === pair.model)
        .map((entry) => entry.provider),
    ),
  ];
  const providers = [...new Set(catalog.map((entry) => entry.provider))].join(
    ", ",
  );
  const detail =
    offerors.length === 0
      ? `the catalog serves these providers: ${providers}`
      : `${pair.model} is only offered by ${offerors.join(", ")}`;
  throw new TypeError(
    `the model policy names ${pair.provider}/${pair.model}, which this Host does not offer (reason: policy-model-unknown); ${detail}.`,
  );
}
