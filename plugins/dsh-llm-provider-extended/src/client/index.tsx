import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import type {
  PropsRuntime,
  InjectFace,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  ProviderCard,
  ROW_SUMMARY,
  type ProviderCardFace,
  type ProviderSettings,
} from "./card.js";
import { styles } from "./styles.js";

export const inject = ["slots", "configForms"];
function Entry(
  props: PropsRuntime<"plugins.row.config"> & InjectFace<ProviderCardFace>,
) {
  return props.view === "summary" ? ROW_SUMMARY : <ProviderCard {...props} />;
}

export function apply(ctx: Context): void {
  const removeStyles = injectCardStyles(
    "@yadsh/dsh-llm-provider-extended",
    styles,
  );
  ctx.effect(() => removeStyles);
  const face: ProviderCardFace = {
    settingsForm: ctx.configForms.get<ProviderSettings>(
      "dsh-llm-provider-extended",
    ),
  };
  ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      {
        name: "plugins.row.config",
        key: "@yadsh/dsh-llm-provider-extended#dsh-llm-provider-extended",
        inject: () => face,
      },
      Entry,
    ),
  );
}
