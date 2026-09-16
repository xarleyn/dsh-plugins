/**
 * What the config sections share: the props every section receives, the
 * override check behind the modified marker, and the reset control that
 * clears a whole section with one click.
 */

import type { ReactNode } from "react";
import type {
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
} from "../../../types.js";
import { ResetButton, type SectionProps } from "../fields.js";

export interface ConfigProps extends SectionProps {
  readonly config: QaSurfaceConfig | undefined;
  /**
   * What the running Host resolved, when it answered. A control whose default
   * is not a literal — the running phrases — reads the effective list from
   * here instead of showing an empty field for a setting that is in effect.
   */
  readonly effective: ResolvedQaSurfaceConfig | null;
}

/** The setting paths one section owns; its reset clears them in order. */
export type SectionPaths = ReadonlyArray<readonly string[]>;

/** Whether the user layer overrides any of the paths the section owns. */
export function overriddenAny(
  props: ConfigProps,
  paths: SectionPaths,
): boolean {
  return paths.some((path) => props.overridden(path));
}

/**
 * The reset control beside a section whose paths the user layer overrides:
 * one button clearing every path of the section, disabled while the settings
 * namespace itself is read-only.
 */
export function resetAside(props: ConfigProps, paths: SectionPaths): ReactNode {
  if (!overriddenAny(props, paths)) return undefined;
  return (
    <ResetButton
      disabled={!props.writable}
      label="Сбросить"
      onClick={() => {
        for (const path of paths) props.unset(path);
      }}
    />
  );
}
