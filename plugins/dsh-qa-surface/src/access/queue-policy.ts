/**
 * The request-ceiling chain, folded where a turn is admitted.
 *
 * The deployment's `session.maxActiveRequests` is the profile's default, and a
 * role or an account may override it — the same three layers the model policy
 * folds, read per turn rather than once at boot, so a settings write reaches
 * the next admission without reloading the plugin.
 */

/** The layer an effective ceiling came from; diagnostics name it with the value. */
export type QaQueueSlotsLayer = "account" | "subrole" | "deployment";

export interface QaQueueSlotsPolicy {
  readonly limit: number;
  readonly layer: QaQueueSlotsLayer;
}

/**
 * Fold the named layers into one effective ceiling.
 *
 * The first layer that names a value wins outright: an account that overrides
 * its role says how many slots it means, and a role that keeps no opinion
 * defers to the deployment below it. 0 is a real value — a layer may drop the
 * ceiling for its own principal even when the deployment sets one.
 * @param layers - the layers in priority order; only `deployment` is required,
 *   because the profile default always speaks.
 */
export function resolveQueueSlots(layers: {
  readonly account?: number | undefined;
  readonly subrole?: number | undefined;
  readonly deployment: number;
}): QaQueueSlotsPolicy {
  const order: readonly QaQueueSlotsLayer[] = [
    "account",
    "subrole",
    "deployment",
  ];
  const values: Record<QaQueueSlotsLayer, number | undefined> = {
    account: layers.account,
    subrole: layers.subrole,
    deployment: layers.deployment,
  };
  const layer = order.find((candidate) => values[candidate] !== undefined);
  return Object.freeze({
    limit: layer === undefined ? layers.deployment : (values[layer] as number),
    layer: layer ?? "deployment",
  });
}
