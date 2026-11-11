// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QaInputForm,
  QaInputForms,
} from "../../../src/client/components/QaInputForm.js";
import { QaFormItem } from "../../../src/client/components/QaFormItem.js";
import type { QaFormApi } from "../../../src/client/forms.js";
import type { QaFormView } from "../../../src/forms/types.js";
import { textOnly } from "../../forms/schemas.js";
import { memoryFixture } from "../../forms/memory-store.js";
const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const close of closes.splice(0)) close();
});
function setup() {
  const f = memoryFixture();
  closes.push(() => f.close());
  const record = f.service.create("chat-a", "intake", textOnly);
  const view = () => f.service.view(f.service.get("chat-a", record.id), true);
  const result = <T,>(value: T) => ({
    ok: true as const,
    value: { ok: true as const, value },
  });
  const api: QaFormApi = {
    get: async () => result(view()),
    list: async () => result([view()]),
    mutate: vi.fn(async (_token, _session, command) => {
      try {
        f.service.command("chat-a", command);
        return result(view());
      } catch (error) {
        return {
          ok: true as const,
          value: {
            ok: false as const,
            error: {
              code: "FORM_INCOMPLETE",
              message: error instanceof Error ? error.message : "Failure",
            },
          },
        };
      }
    }),
    upload: vi.fn(async () => {}),
    file: vi.fn(),
  };
  const props = {
    api,
    session: "chat-a",
    token: "demo-token",
    form: view(),
    canStop: true,
    onStop: vi.fn(async () => {}),
    onResume: vi.fn(),
    onTakeover: vi.fn(),
  };
  return { f, props, view };
}
describe("strict form interaction", () => {
  it("hides a completed form across polls/remounts without resuming or editing it", async () => {
    const { props, f } = setup();
    const list = vi.spyOn(props.api, "list");
    const r = f.store.list("chat-a")[0]!;
    f.service.command("chat-a", {
      action: "save",
      form_id: r.id,
      expected_revision: r.revision,
      mutation_id: "answer",
      answers: { answer: { type: "text", text: "Complete" } },
      step: 0,
    });
    f.service.command("chat-a", {
      action: "submit",
      form_id: r.id,
      expected_revision: f.store.get("chat-a", r.id).revision,
      mutation_id: "submit",
    });
    const mounted = render(<QaInputForms {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Скрыть отправленную форму" }),
    );
    expect(props.onResume).not.toHaveBeenCalled();
    expect(props.api.mutate).not.toHaveBeenCalled();
    mounted.unmount();
    render(<QaInputForms {...props} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Скрыть отправленную форму" }),
    ).toBeNull();
    expect(f.store.get("chat-a", r.id).status).toBe("submitted");
  });
  it("shows initial polling failures and retries before any form exists", async () => {
    const { props } = setup();
    const list = vi.spyOn(props.api, "list");
    list.mockRejectedValueOnce(new Error("offline"));
    render(<QaInputForms {...props} />);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку форм" }),
    );
    await screen.findByRole("textbox");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports domain refusals, preserves the existing form and refreshes on focus", async () => {
    const { props } = setup();
    const list = vi.spyOn(props.api, "list");
    render(<QaInputForms {...props} />);
    await screen.findByRole("textbox");
    list.mockResolvedValueOnce({
      ok: true,
      value: {
        ok: false,
        error: { code: "ACCESS_DENIED", message: "Unavailable" },
      },
    });
    fireEvent.focus(window);
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox")).toBeDefined();
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not overlap owner polls while a slow request is pending", async () => {
    const { props } = setup();
    const list = vi
      .spyOn(props.api, "list")
      .mockImplementation(() => new Promise(() => {}));
    const rendered = render(<QaInputForms {...props} />);
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    expect(list).toHaveBeenCalledOnce();
    rendered.unmount();
    fireEvent.focus(window);
    expect(list).toHaveBeenCalledOnce();
  });

  it("has no skip, persists input, reviews and submits with explicit navigation", async () => {
    const { props, f } = setup();
    render(<QaInputForm {...props} />);
    expect(screen.queryByRole("button", { name: "Пропустить" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Задача проекта" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("Проверьте данные");
    expect(f.store.list("chat-a")[0]!.status).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: "Передать данные" }));
    await waitFor(() =>
      expect(f.store.list("chat-a")[0]!.status).toBe("submitted"),
    );
  });
  it("explains server refusal and does not submit missing required input", async () => {
    const { props, f } = setup();
    render(<QaInputForm {...props} />);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Далее" }).disabled,
    ).toBe(true);
    expect(screen.getByText(/Ответьте на вопрос/u)).toBeDefined();
    expect(f.store.list("chat-a")[0]!.status).toBe("draft");
    expect(screen.queryByText("Проверьте данные")).toBeNull();
  });
  it("Stop reaches the turn immediately and pause saves a durable draft", async () => {
    const { props, f } = setup();
    render(<QaInputForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(props.onStop).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Saved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить и выйти" }));
    await screen.findByRole("button", { name: "Открыть форму" });
    expect(f.store.list("chat-a")[0]!.answers.answer).toEqual({
      type: "text",
      text: "Saved",
    });
    expect(f.store.list("chat-a")[0]!.status).toBe("draft");
  });
  it("radio choices do not auto-advance or preselect recommended options", () => {
    const onAnswer = vi.fn();
    const props = {
      item: {
        id: "pick",
        title: "Выбор",
        answer: {
          type: "single_select" as const,
          required: true,
          options: [{ value: "a", label: "А", recommended: true }],
        },
        files: { requirement: "none" as const },
      },
      answer: null,
      files: [],
      uploads: [],
      disabled: false,
      onAnswer,
      onUpload: vi.fn(),
      onRemove: vi.fn(),
      onCancel: vi.fn(),
      onOpen: vi.fn(),
    };
    render(<QaFormItem {...props} />);
    const radio = screen.getByRole<HTMLInputElement>("radio");
    expect(radio.checked).toBe(false);
    fireEvent.click(radio);
    expect(onAnswer).toHaveBeenCalledWith({
      type: "single_select",
      selected: ["a"],
    });
    expect(screen.queryByRole("button", { name: "Далее" })).toBeNull();
  });
  it("renders restored ready files without uploading again", () => {
    const { props } = setup();
    const record: QaFormView = {
      ...props.form,
      waiting: false,
      attachments: {},
    };
    render(<QaInputForm {...props} form={record} />);
    expect(screen.getByRole("button", { name: "Открыть форму" })).toBeDefined();
    expect(props.api.upload).not.toHaveBeenCalled();
  });
});
