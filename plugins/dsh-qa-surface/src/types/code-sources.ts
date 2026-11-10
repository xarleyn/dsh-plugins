/** Browser-safe source selection state; filesystem access is configured separately. */
export interface QaChatCodeSources {
  readonly selectedSource: string | null;
  readonly effectiveSource: string | null;
  readonly entries: readonly { readonly id: string; readonly label: string }[];
  readonly writable: boolean;
  readonly unavailable: boolean;
}
