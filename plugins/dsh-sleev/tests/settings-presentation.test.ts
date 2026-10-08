import { Context, Service } from "@deepseek-ai/cordis";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { describe, expect, it } from "vitest";
import SleevIntegrationService from "../src/index.js";

/**
 * The Host settings service at the size this plugin leans on it.
 *
 * `configure({ auto: false }, fiber)` is the lever that declines the page the
 * Host would otherwise generate for a volatile namespace, and `describe()`
 * reports the result as `autoGenerate`. The card sits on the bundle row of the
 * Plugins page and draws the form itself, so a namespace left answering `auto`
 * gets a second, host-written editor of the same four fields next to it.
 */
class FakeSettingsService extends Service {
  /** Every presentation the plugin asked for, with the fiber it was bound to. */
  readonly presentations: {
    readonly presentation: unknown;
    readonly fiber: unknown;
  }[] = [];

  constructor(ctx: Context) {
    super(ctx, "settings");
  }

  configure(presentation: unknown, fiber: unknown): void {
    this.presentations.push({ presentation, fiber });
  }
}

describe("host settings presentation", () => {
  it("declines the generated page exactly once, for its own fiber", async () => {
    const ctx = new Context();
    const settings = new FakeSettingsService(ctx);
    await ctx.plugin(LlmRuntime);
    const fiber = await ctx.plugin(SleevIntegrationService, {
      logLevel: "off",
    });

    // The lever is taken through `ctx.inject(['settings'])`, so it lands on the
    // task the registry activates the injection with, not inside the constructor.
    await expect.poll(() => settings.presentations.length).toBe(1);
    expect(settings.presentations[0]?.presentation).toEqual({ auto: false });
    expect(settings.presentations[0]?.fiber).toBe(fiber);

    await ctx.fiber.dispose();
  });
});
