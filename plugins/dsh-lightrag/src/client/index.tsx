import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import type { LightRagConfig } from "../config.js";
import { LightRagCard, type LightRagCardProps } from "./card.js";
import { styles } from "./styles.js";

export const inject = ["slots", "configForms"];

export function LightRagSettingsEntry(props: LightRagCardProps) {
  if (props.view === "summary")
    return "Knowledge-base tools over a LightRAG graph-RAG index: ask, inspect the catalog, check its health.";
  return <LightRagCard {...props} />;
}

export async function apply(ctx: Context): Promise<void> {
  const removeStyles = injectCardStyles("@yadsh/dsh-lightrag", styles);
  ctx.effect(() => removeStyles, "dsh-lightrag.card-styles");
  await ctx.inject(["configForms"], (formCtx) => {
    const settingsForm =
      formCtx.configForms.get<LightRagConfig>("dsh-lightrag");
    return ctx.slots.inject("plugins.row.config", () =>
      ctx.slots.register(
        {
          name: "plugins.row.config",
          key: "@yadsh/dsh-lightrag#dsh-lightrag",
          inject: () => ({ settingsForm }),
        },
        LightRagSettingsEntry,
      ),
    );
  });
}
