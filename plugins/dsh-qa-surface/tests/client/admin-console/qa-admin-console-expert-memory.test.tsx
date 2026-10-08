// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  QaExpertMemoryDraft,
  QaExpertMemoryRecord,
  QaExpertMemoryScope,
} from "../../../src/types.js";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";

/**
 * The console's memory page: what an expert remembered, and the two things an
 * operator does about a line that turned out to be wrong — correct it or delete
 * it.
 */

const TOKEN = "token";

/** The console mounts against a shared CI container; see the other page tests. */
const MOUNT_TIMEOUT = { timeout: 15_000 } as const;

const SCOPES: readonly QaExpertMemoryScope[] = [
  {
    domainId: "payments",
    domainName: "Платежи",
    namespace: "domain/payments",
    access: "read-write",
    records: 2,
  },
  {
    domainId: "platform",
    domainName: "Платформа",
    namespace: "shared/product",
    access: "read-only",
    records: 0,
  },
];

const RECORDS: readonly QaExpertMemoryRecord[] = [
  {
    namespace: "domain/payments",
    key: "cutoff",
    text: "The settlement cutoff is 14:00.",
    tags: ["batch"],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
  },
  {
    namespace: "domain/payments",
    key: "refund-window",
    text: "Refunds run for ten days.",
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_050_000,
  },
];

function rig(scopes = SCOPES, records = RECORDS) {
  const memoryScopes = vi.fn(async () => ({
    ok: true as const,
    value: scopes,
  }));
  // Namespace-aware like the store: a page that answered every namespace with
  // the same rows would hide a picker that switched to nothing.
  const memoryRecords = vi.fn(async (_token: string, namespace: string) => {
    const rows = namespace === "domain/payments" ? records : [];
    return {
      ok: true as const,
      value: { records: rows, total: rows.length, offset: 0, limit: 25 },
    };
  });
  const correctMemory = vi.fn(
    async (
      _token: string,
      namespace: string,
      key: string,
      draft: QaExpertMemoryDraft,
    ) => ({
      ok: true as const,
      value: {
        namespace,
        key,
        text: draft.text,
        tags: [...draft.tags],
        createdAt: RECORDS[0]?.createdAt ?? 0,
        updatedAt: (RECORDS[0]?.updatedAt ?? 0) + 1_000,
      },
    }),
  );
  const forgetMemory = vi.fn(async () => ({ ok: true as const, value: 1 }));
  const wipeMemory = vi.fn(async () => ({ ok: true as const, value: 2 }));
  return {
    api: adminApi({
      memoryScopes,
      memoryRecords,
      correctMemory,
      forgetMemory,
      wipeMemory,
    }),
    memoryScopes,
    memoryRecords,
    correctMemory,
    forgetMemory,
    wipeMemory,
  };
}

describe("admin console expert memory", () => {
  it("opens on the first expert and lists what it remembered", async () => {
    const { api, memoryRecords } = rig();
    renderConsole(api, "/qa/admin/memory");
    expect(
      await screen.findByRole("heading", { name: "Память экспертов" }),
    ).toBeTruthy();
    const rows = await screen.findAllByTestId(
      "qa-admin-memory-row",
      {},
      MOUNT_TIMEOUT,
    );
    const first = within(rows[0] as HTMLElement);
    expect(first.getByTestId("qa-admin-memory-key").textContent).toBe("cutoff");
    expect(first.getByTestId("qa-admin-memory-text").textContent).toBe(
      "The settlement cutoff is 14:00.",
    );
    expect(memoryRecords).toHaveBeenCalledWith(
      TOKEN,
      "domain/payments",
      "",
      25,
      0,
    );
  });

  it("switches namespace from the picker instead of guessing one", async () => {
    const { api, memoryRecords } = rig();
    renderConsole(api, "/qa/admin/memory");
    const filter = await screen.findByTestId(
      "qa-admin-memory-filter-expert",
      {},
      MOUNT_TIMEOUT,
    );
    // The control is still a combobox carrying the label the operator reads.
    const picker = within(filter).getByRole("combobox");
    fireEvent.change(picker, { target: { value: "shared/product" } });
    await waitFor(() => {
      expect(memoryRecords).toHaveBeenLastCalledWith(
        TOKEN,
        "shared/product",
        "",
        25,
        0,
      );
    }, MOUNT_TIMEOUT);
  });

  it("sends a corrected line and reloads the list", async () => {
    const { api, correctMemory, memoryRecords } = rig();
    renderConsole(api, "/qa/admin/memory");
    const editors = await screen.findAllByRole("button", { name: "Править" });
    fireEvent.click(editors[0] as HTMLElement);
    const editor = await screen.findByTestId(
      "qa-admin-memory-editor",
      {},
      MOUNT_TIMEOUT,
    );
    const field = within(editor).getByRole("textbox", {
      name: "Текст записи cutoff",
    });
    fireEvent.change(field, {
      target: { value: "The settlement cutoff is 15:00." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => {
      expect(correctMemory).toHaveBeenCalledWith(
        TOKEN,
        "domain/payments",
        "cutoff",
        { text: "The settlement cutoff is 15:00.", tags: ["batch"] },
      );
    }, MOUNT_TIMEOUT);
    expect(
      (await screen.findByTestId("qa-admin-memory-notice", {}, MOUNT_TIMEOUT))
        .textContent,
    ).toBe("Запись cutoff исправлена.");
    // The list is read back from the store rather than patched in place: an
    // expert may have written to the same namespace while the editor was open.
    expect(memoryRecords.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps the save dead until the draft actually changed", async () => {
    const { api, correctMemory } = rig();
    renderConsole(api, "/qa/admin/memory");
    const editors = await screen.findAllByRole("button", { name: "Править" });
    fireEvent.click(editors[0] as HTMLElement);
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save.hasAttribute("disabled")).toBe(true);
    const editor = screen.getByTestId("qa-admin-memory-editor");
    fireEvent.change(
      within(editor).getByRole("textbox", { name: "Текст записи cutoff" }),
      { target: { value: "   " } },
    );
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(correctMemory).not.toHaveBeenCalled();
  });

  it("deletes one line after a confirmation, and not before", async () => {
    const { api, forgetMemory } = rig();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderConsole(api, "/qa/admin/memory");
    const removes = await screen.findAllByRole("button", { name: "Удалить" });
    fireEvent.click(removes[0] as HTMLElement);
    expect(forgetMemory).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(removes[0] as HTMLElement);
    await waitFor(() => {
      expect(forgetMemory).toHaveBeenCalledWith(TOKEN, "domain/payments", [
        "cutoff",
      ]);
    }, MOUNT_TIMEOUT);
    confirm.mockRestore();
  });

  it("deletes a selection in one call", async () => {
    const { api, forgetMemory } = rig();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderConsole(api, "/qa/admin/memory");
    const boxes = await screen.findAllByRole("checkbox", {}, MOUNT_TIMEOUT);
    // The first is the page-wide control; the rows follow it.
    fireEvent.click(boxes[1] as HTMLElement);
    fireEvent.click(boxes[2] as HTMLElement);
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить выбранное (2)" }),
    );
    await waitFor(() => {
      expect(forgetMemory).toHaveBeenCalledWith(TOKEN, "domain/payments", [
        "cutoff",
        "refund-window",
      ]);
    }, MOUNT_TIMEOUT);
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("offers the bulk control only once something is ticked", async () => {
    const { api } = rig();
    renderConsole(api, "/qa/admin/memory");
    expect(
      (await screen.findAllByTestId("qa-admin-memory-row", {}, MOUNT_TIMEOUT))
        .length,
    ).toBe(2);
    expect(
      screen.queryByRole("button", { name: /Удалить выбранное/ }),
    ).toBeNull();
  });

  it("wipes a namespace with the count the operator was shown", async () => {
    const { api, wipeMemory } = rig();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderConsole(api, "/qa/admin/memory");
    fireEvent.click(
      await screen.findByTestId("qa-admin-memory-wipe", {}, MOUNT_TIMEOUT),
    );
    await waitFor(() => {
      expect(wipeMemory).toHaveBeenCalledWith(TOKEN, "domain/payments", 2);
    }, MOUNT_TIMEOUT);
    expect(String(confirm.mock.calls[0]?.[0])).toContain("2");
    confirm.mockRestore();
  });

  it("hides every write control from a reviewer and says why", async () => {
    const { api, memoryRecords } = rig();
    renderConsole(api, "/qa/admin/memory", "reviewer");
    // The section stays in a reviewer's navigation: noticing a remembered
    // inaccuracy is a review finding, so reading is theirs to do.
    expect(
      await screen.findByRole("button", { name: "Память экспертов" }),
    ).toBeTruthy();
    expect(
      (await screen.findAllByTestId("qa-admin-memory-row", {}, MOUNT_TIMEOUT))
        .length,
    ).toBe(2);
    expect(screen.queryByRole("button", { name: "Править" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(memoryRecords).toHaveBeenCalled();
  });

  it("will not write a namespace an expert only reads from", async () => {
    const { api } = rig();
    renderConsole(api, "/qa/admin/memory");
    const filter = await screen.findByTestId(
      "qa-admin-memory-filter-expert",
      {},
      MOUNT_TIMEOUT,
    );
    fireEvent.change(within(filter).getByRole("combobox"), {
      target: { value: "shared/product" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("qa-admin-empty").textContent).toContain(
        "В этом пространстве пока ничего не записано.",
      );
    }, MOUNT_TIMEOUT);
    expect(
      screen.queryByRole("button", { name: "Очистить пространство" }),
    ).toBeNull();
  });

  it("says there is nothing to maintain when the stand has no experts", async () => {
    const { api } = rig([], []);
    renderConsole(api, "/qa/admin/memory");
    expect(
      (await screen.findByTestId("qa-admin-empty", {}, MOUNT_TIMEOUT))
        .textContent,
    ).toContain("На этом стенде нет экспертов с памятью");
  });

  it("answers a memory-unavailable refusal with the console's own copy", async () => {
    const { api } = rig();
    api.memoryScopes = vi.fn(async () => ({
      ok: false as const,
      error: new Error(
        "QA accounts refused the request (reason: memory-unavailable)",
      ),
    }));
    renderConsole(api, "/qa/admin/memory");
    expect(
      (await screen.findByRole("alert", {}, MOUNT_TIMEOUT)).textContent,
    ).toContain("Память экспертов на этом стенде недоступна");
  });
});
