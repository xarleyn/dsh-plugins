import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/resolve-config.js";
import { QaSessionController } from "../../../src/client/QaSessionController.js";
import type { QaFileUpload } from "../../../src/client/types.js";
import type {
  QaSlashExecution,
  QaSlashSubmitAttachment,
} from "../../../src/types.js";
import {
  deferredUpload,
  fileDraft,
  harness,
  landDurableUserRow,
} from "../../helpers/session-fakes.js";
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
    /** The chats this browser indexes; the first one is the open chat. */
    readonly chats?: readonly string[];
    readonly fileUpload?: () => QaFileUpload | undefined;
  } = {},
) {
  const base = harness([...(options.chats ?? ["saved"])]);
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
    ...(options.fileUpload === undefined
      ? {}
      : { fileUpload: options.fileUpload }),
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
 * Retire the optimistic submission of the previous send the way the Host does:
 * one turn runs and ends, and then the Chat slice lands the durable user row
 * that replaces the browser's copy of the question.
 */
function settle(built: ReturnType<typeof world>, text = "hello"): void {
  const face = built.faces.get("saved");
  if (face === undefined) return;
  face.source.set({ ...face.source.getSnapshot(), running: true });
  face.source.set({ ...face.source.getSnapshot(), running: false });
  landDurableUserRow(built.bindings.get("saved"), text);
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

  it("never runs a command whose attachment finished staging after the chat was left", async () => {
    // Issue #339: the upload is a round-trip, and the operator may switch
    // chats during it. A human command mutates the chat on the Host's side, so
    // the binding is re-checked after the staging and before the execute.
    const upload = deferredUpload();
    const built = await ready({
      chats: ["saved", "other"],
      entries: [{ ...COMMAND, acceptsAttachments: true }, SKILL],
      fileUpload: () => upload.service,
    });
    await vi.waitFor(() => {
      expect(built.controller.getSnapshot().slash.state).toBe("ready");
    });

    const running = built.controller.send("/compact", [fileDraft()]);
    await vi.waitFor(() =>
      expect(upload.service.upload).toHaveBeenCalledOnce(),
    );

    await built.controller.switchTo("other");
    upload.settle();

    expect(await running).toBe(false);
    expect(built.execute).not.toHaveBeenCalled();
    expect(built.faces.get("other")?.prompt).not.toHaveBeenCalled();
    built.controller.dispose();
  });
});
