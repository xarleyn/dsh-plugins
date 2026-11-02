/** Poll ticks share one read; a mutation can reserve one forced read after it. */
export function coalesceBrowserRefresh(
  read: (forceFrame: boolean) => Promise<void>,
  current: () => boolean = () => true,
): (forceFrame: boolean) => Promise<void> {
  let running: Promise<void> | undefined;
  let forceNext = false;
  return (forceFrame) => {
    if (!current()) return Promise.resolve();
    if (running !== undefined) {
      forceNext ||= forceFrame;
      return running;
    }
    running = (async () => {
      let force = forceFrame;
      do {
        forceNext = false;
        await read(force);
        force = forceNext;
      } while (forceNext && current());
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
}
