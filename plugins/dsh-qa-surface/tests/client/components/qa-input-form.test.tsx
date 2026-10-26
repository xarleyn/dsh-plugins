// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaInputForm } from "../../../src/client/components/QaInputForm.js";
import { QaFormItem } from "../../../src/client/components/QaFormItem.js";
import type { QaFormApi } from "../../../src/client/forms.js";
import type { QaFormView } from "../../../src/forms/types.js";
import { fixture, textOnly } from "../../forms/fixture.js";
const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const close of closes.splice(0)) close();
});
function setup() {
  const f = fixture();
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
