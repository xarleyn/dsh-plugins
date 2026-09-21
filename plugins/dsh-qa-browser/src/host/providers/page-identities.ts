import { randomUUID } from "node:crypto";

/**
 * Page identities for one Browser context.
 *
 * The Host has to know which tab a refused request belongs to, and the only
 * thing the provider's route handler sees is a Playwright page. Handing out an
 * id when a page is *created* would leave a window: a request the brand-new
 * page makes before its handle reaches the caller would have no identity to
 * carry back. So the identity is minted the first time anything asks for it —
 * the route handler and the page handle ask the same registry about the same
 * object, and get the same answer whichever asked first.
 *
 * The keys are weak, because a closed page is nothing this registry should keep
 * alive: a chat can open and close pages all day.
 */
export class PageIdentities<K extends object = object> {
  private readonly ids = new WeakMap<K, string>();

  idOf(page: K): string {
    const known = this.ids.get(page);
    if (known !== undefined) return known;
    const id = `page_${randomUUID().replaceAll("-", "")}`;
    this.ids.set(page, id);
    return id;
  }
}
