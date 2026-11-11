import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import type { AnswerReviewGateConfig } from "../config.js";
import { ReviewSettingsEntry, REVIEW_SETTINGS_STYLES } from "./card.js";

export const inject = ["slots", "configForms"];
/** Register the editable body on the bundle's own Plugins row. */
export function apply(ctx: Context): () => void {
  const settingsForm = ctx.configForms.get<AnswerReviewGateConfig>(
    "dsh-answer-review-gate",
  );
  const removeStyles = injectCardStyles(
    "@yadsh/dsh-answer-review-gate",
    REVIEW_SETTINGS_STYLES,
  );
  const removeCard = ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      {
        name: "plugins.row.config",
        key: "@yadsh/dsh-answer-review-gate#dsh-answer-review-gate",
        inject: () => ({ settingsForm }),
      },
      ReviewSettingsEntry,
    ),
  );
  return () => {
    removeCard();
    removeStyles();
  };
}
