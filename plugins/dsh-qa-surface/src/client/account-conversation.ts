import type { Context } from "@deepseek-ai/cordis";
import type { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaSessions } from "./types.js";

/** Native assembly must use the same Session scope as the secured transport. */
export function createQaAccountConversation(ctx: Context, sessions: QaSessions, source: UiConversation): UiConversation {
  const Constructor = source.constructor as new (context: Context, sessions: QaSessions) => UiConversation;
  const conversation = new Constructor(ctx.isolate("uiConversation"), sessions);
  const disposers: (() => void)[] = [];
  const sync = () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
    for (const definition of source.events.entries()) disposers.push(conversation.events.register(definition));
    const fallback = source.events.fallbackEntry();
    if (fallback !== undefined) disposers.push(conversation.events.registerFallback(fallback));
    for (const definition of source.views.entries()) disposers.push(conversation.views.register(definition));
    for (const definition of source.groups.entries()) disposers.push(conversation.groups.register(definition as never));
  };
  sync();
  const unsubscribe = [source.events.subscribe(sync), source.views.subscribe(sync), source.groups.subscribe(sync)];
  ctx.effect(() => () => { for (const dispose of unsubscribe) dispose(); for (const dispose of disposers) dispose(); }, "qa.account-conversation");
  return conversation;
}
