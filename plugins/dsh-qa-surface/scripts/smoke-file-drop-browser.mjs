/** Prove file-drop ownership with real browser DataTransfer and Host listeners. */
export async function runFileDropBrowserPass(page) {
  const emit = async (type, selector) =>
    page.evaluate(
      ({ type, selector }) => {
        const target = globalThis.document.querySelector(selector);
        if (target === null)
          throw new Error(`drop target missing: ${selector}`);
        const data = new globalThis.DataTransfer();
        data.items.add(
          new globalThis.File(["demo"], "dropped.txt", { type: "text/plain" }),
        );
        const event = new globalThis.DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        });
        // A document listener represents the same boundary as the Host overlay.
        let reachedHost = false;
        const observe = () => {
          reachedHost = true;
        };
        globalThis.document.addEventListener(type, observe);
        target.dispatchEvent(event);
        globalThis.document.removeEventListener(type, observe);
        return { prevented: event.defaultPrevented, reachedHost };
      },
      { type, selector },
    );

  for (const [type, selector] of [
    ["dragenter", "body"],
    ["dragover", "#dsh-qa-prompt"],
    ["drop", "#dsh-qa-prompt"],
  ]) {
    const result = await emit(type, selector);
    if (!result.prevented || result.reachedHost)
      throw new Error(
        `QA file ${type} escaped to the Host: ${JSON.stringify(result)}`,
      );
  }
  const dropped = page.getByRole("button", {
    name: "Убрать dropped.txt",
    exact: true,
  });
  await dropped.waitFor({ timeout: 10_000 });
  if ((await dropped.count()) !== 1)
    throw new Error("file drop was duplicated");
  await dropped.click();
  await dropped.waitFor({ state: "detached" });

  // Dropping on the transcript also reaches the composer, without an overlay.
  const result = await emit("drop", "main.dsh-qa-surface");
  if (!result.prevented || result.reachedHost)
    throw new Error("page-wide file drop escaped to the Host");
  await dropped.waitFor({ timeout: 10_000 });
  await dropped.click();
  await dropped.waitFor({ state: "detached" });
}
