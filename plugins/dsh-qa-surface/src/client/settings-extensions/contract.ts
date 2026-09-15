import type { Context } from "@deepseek-ai/cordis";
import type { ComponentType } from "react";

/** Trusted browser identity supplied by QA Surface to a settings extension. */
export interface QaUserSettingsSectionProps {
  /** Current QA account token. It is used only as transport authentication. */
  readonly token: string;
}

/** One first-class page in the signed-in user's QA settings dialog. */
export interface QaUserSettingsSectionRegistration {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly component: ComponentType<QaUserSettingsSectionProps>;
}

export interface QaUserSettingsSectionsSnapshot {
  readonly sections: readonly QaUserSettingsSectionRegistration[];
  readonly revision: number;
}

/** Client-side registry exposed by QA Surface to additive plugins. */
export interface QaUserSettingsSections {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => QaUserSettingsSectionsSnapshot;
  register(section: QaUserSettingsSectionRegistration): () => void;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaUserSettingsSections: QaUserSettingsSections;
  }
}

/** Structural face used by consumers that do not otherwise depend on Cordis. */
export type QaUserSettingsSectionsContext = Pick<
  Context,
  "qaUserSettingsSections"
>;
