import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/resolve-config.js";
import { QaSessionController } from "../../../src/client/QaSessionController.js";
import type {
  QaSlashExecution,
  QaSlashSubmitAttachment,
} from "../../../src/types.js";
import { harness } from "../../helpers/session-fakes.js";
import { slashEntry } from "../../helpers/slash.js";

/**
 * The composer's half of the slash contract: what reaches `session.prompt`,
 * what reaches the command remote, and what happens to the draft when either
 * side refuses. The native runtimes are faked; their own behaviour is covered
 * by the Host suite.
 */

const ENABLED = resolveConfig({
  lockdown: { allowSlashCommands: true },
  slashCommands: {
    skills: { mode: "allow-list", allow: ["generate-tkp"] },
    commands: { mode: "allow-list", allow: ["compact"] },
    palette: { enabled: true },
  },
} as never);

const SKILL = slashEntry("skill", "generate-tkp", {
  description: "Сформировать ТКП",
});
const COMMAND = slashEntry("command", "compact", {
  description: "Compact conversation",
});

function world(
  options: {
    readonly config?: ReturnType<typeof resolveConfig>;
    readonly entries?: readonly ReturnType<typeof slashEntry>[];
    readonly execute?: (
      line: string,
      attachments: readonly QaSlashSubmitAttachment[],
    ) => QaSlashExecution;
    readonly catalogOk?: boolean;
    readonly deniedSkills?: readonly string[];
  } = {},
) {
  const base = harness(["saved"]);
  base.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
  const execute = vi.fn(
    async (
      _token: string,
      _sessionId: string,
      line: string,
      attachments: readonly QaSlashSubmitAttachment[],
    ) => ({
      ok: true as const,
      value:
        options.execute?.(line, attachments) ??
        ({
          kind: "executed",
          commandId: "cmd-1",
          outcome: { kind: "success", text: "Готово" },
        } as const),
    }),
  );
  const catalog = vi.fn(async () => ({
    ok: true as const,
    value:
      options.catalogOk === false
        ? undefined
        : {
            enabled: true,
            entries: options.entries ?? [SKILL, COMMAND],
            commandSurface: "ready" as const,
            deniedSkills: options.deniedSkills ?? [],
          },
  }));
  const controller = new QaSessionController({
    ...base,
    config: options.config ?? ENABLED,
    slashApi: {
      catalog: catalog as never,
      execute: execute as never,
    },
  });
  return { ...base, controller, execute, catalog };
}

async function ready(options: Parameters<typeof world>[0] = {}) {
  const built = world(options);
  await built.controller.ensureSession();
  return built;
}

/**
 * Retire the optimistic submission of the previous send. The composer stays
 * busy until the Host's own user row lands, and the harness only produces one
 * when the turn runs — which is exactly what this reproduces.
 */
function settle(built: ReturnType<typeof world>): void {
  const face = built.faces.get("saved");
  if (face === undefined) return;
  face.source.set({ ...face.source.getSnapshot(), running: true });
  face.source.set({ ...face.source.getSnapshot(), running: false });
}

describe("QA session controller slash routing", () => {
  it("keeps the pre-feature refusal while the switch is off", async () => {
    const built = await ready({ config: resolveConfig() });
    expect(await built.controller.send("hello")).toBe(true);
    settle(built);
    expect(await built.controller.send("/settings")).toBe(false);
    expect(built.controller.getSnapshot().error).toMatch(/Команды со слешем/u);
    expect(built.execute).not.toHaveBeenCalled();
    built.controller.dispose();
  });

  it("reads the catalog for the bound chat and drops it with the binding", async () => {
    const built = await ready();
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    expect(built.controller.getSnapshot().slash.entries).toHaveLength(2);
    expect(built.catalog).toHaveBeenCalledWith("", "saved");
    built.controller.dispose();
  });

  it("keeps ordinary prompts working when the catalog cannot be read", async () => {
    const built = await ready({ catalogOk: false });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("error");
    });
    // A refusal for a slash line, but never for the model path.
    expect(await built.controller.send("обычный вопрос")).toBe(true);
    expect(built.faces.get("saved")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "обычный вопрос" }],
      "queue",
    );
    built.controller.dispose();
  });

  it("sends a skill invocation through the native prompt path", async () => {
    const built = await ready();
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    expect(await built.controller.send("/generate-tkp Сделай ТКП")).toBe(true);
    expect(built.faces.get("saved")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "/generate-tkp Сделай ТКП" }],
      "queue",
    );
    // QA never loads the skill body itself.
    expect(built.execute).not.toHaveBeenCalled();
    built.controller.dispose();
  });

  it("runs an admitted command without creating a model message", async () => {
    const built = await ready();
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    const prompts = built.faces.get("saved")?.prompt.mock.calls.length ?? 0;
    expect(await built.controller.send("/compact")).toBe(true);
    expect(built.execute).toHaveBeenCalledWith("", "saved", "/compact", []);
    expect(built.faces.get("saved")?.prompt.mock.calls.length ?? 0).toBe(
      prompts,
    );
    built.controller.dispose();
  });

  it("refuses an unknown action instead of sending it to the model", async () => {
    const built = await ready();
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    const prompts = built.faces.get("saved")?.prompt.mock.calls.length ?? 0;
    expect(await built.controller.send("/does-not-exist")).toBe(false);
    expect(built.controller.getSnapshot().error).toMatch(
      /Неизвестное действие/u,
    );
    expect(built.faces.get("saved")?.prompt.mock.calls.length ?? 0).toBe(
      prompts,
    );
    // The palette re-opens beside the refusal, with the counter as the signal.
    expect(built.controller.getSnapshot().slash.reopen).toBe(1);
    built.controller.dispose();
  });

  it("asks the user to choose when a skill and a command share a name", async () => {
    const built = await ready({
      entries: [slashEntry("skill", "plan"), slashEntry("command", "plan")],
    });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    expect(await built.controller.send("/plan")).toBe(false);
    expect(built.controller.getSnapshot().error).toMatch(
      /Найдены навык и команда/u,
    );
    expect(built.execute).not.toHaveBeenCalled();
    built.controller.dispose();
  });

  it("honours the entry the user picked out of a collision", async () => {
    const built = await ready({
      entries: [slashEntry("skill", "plan"), slashEntry("command", "plan")],
    });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    expect(
      await built.controller.send("/plan сделать", [], "command:plan"),
    ).toBe(true);
    expect(built.execute).toHaveBeenCalledWith(
      "",
      "saved",
      "/plan сделать",
      [],
    );
    built.controller.dispose();
  });

  it("keeps the draft and the attachments when the Host refuses", async () => {
    const built = await ready({
      // The entry admits attachments, so the refusal can only come from the
      // Host — which is the path this test is about.
      entries: [{ ...COMMAND, acceptsAttachments: true }, SKILL],
      execute: () => ({
        kind: "refused",
        reason: "not-allowed",
        message: "no",
      }),
    });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    const image = {
      kind: "image" as const,
      id: "img-1",
      name: "shot.png",
      mediaType: "image/png" as const,
      data: "AA",
      bytes: 1,
      previewUrl: "blob:1",
    };
    expect(await built.controller.send("/compact", [image])).toBe(false);
    expect(built.controller.getSnapshot().error).toMatch(/запрещена/u);
    expect(built.controller.getSnapshot().pendingMessage).toBeNull();
    built.controller.dispose();
  });

  it("refuses attachments for a command that does not take them", async () => {
    const built = await ready();
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    const image = {
      kind: "image" as const,
      id: "img-1",
      name: "shot.png",
      mediaType: "image/png" as const,
      data: "AA",
      bytes: 1,
      previewUrl: "blob:1",
    };
    expect(await built.controller.send("/compact", [image])).toBe(false);
    expect(built.controller.getSnapshot().error).toMatch(
      /не принимает вложения/u,
    );
    expect(built.execute).not.toHaveBeenCalled();
    built.controller.dispose();
  });

  it("holds back a prompt that names a skill the deployment withholds", async () => {
    const built = await ready({ deniedSkills: ["gap-analysis"] });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    expect(
      await built.controller.send("Используй /gap-analysis для требований"),
    ).toBe(false);
    expect(built.controller.getSnapshot().error).toMatch(/gap-analysis/u);
    built.controller.dispose();
  });

  it("keeps the slash view identity stable across stream frames", async () => {
    // The composer is memoized on its props and this view is rebuilt on every
    // publish, including every frame of a running answer: a fresh object each
    // time would re-render the composer for each of them.
    const built = await ready();
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });
    const before = built.controller.getSnapshot().slash;
    const face = built.faces.get("saved");
    if (face === undefined) throw new Error("expected the bound session face");
    for (const running of [true, false]) {
      face.source.set({ ...face.source.getSnapshot(), running });
    }
    expect(built.controller.getSnapshot().slash).toBe(before);
    built.controller.dispose();
  });

  it("never sends a slash line when the catalog is unreadable", async () => {
    const built = await ready({ catalogOk: false });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("error");
    });
    const prompts = built.faces.get("saved")?.prompt.mock.calls.length ?? 0;
    expect(await built.controller.send("/compact")).toBe(false);
    expect(built.faces.get("saved")?.prompt.mock.calls.length ?? 0).toBe(
      prompts,
    );
    expect(built.execute).not.toHaveBeenCalled();
    built.controller.dispose();
  });
});
