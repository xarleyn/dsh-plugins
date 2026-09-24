// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListField } from "../../../src/client/settings/fields.js";
import { parseLineList } from "../../../src/client/settings/format.js";

function renderList(value: readonly string[], onCommit = vi.fn()) {
  const view = render(
    <ListField
      label="Быстрые вопросы"
      value={value}
      disabled={false}
      parse={parseLineList}
      onCommit={onCommit}
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  const rerender = (next: readonly string[]) =>
    view.rerender(
      <ListField
        label="Быстрые вопросы"
        value={next}
        disabled={false}
        parse={parseLineList}
        onCommit={onCommit}
      />,
    );
  return { textarea, rerender, onCommit };
}

describe("list field", () => {
  it("keeps the draft when a caller passes an equal but fresh list", () => {
    // An unset setting is rendered from a literal default, so the array
    // identity changes on every parent render.
    const { textarea, rerender } = renderList([]);
    fireEvent.change(textarea, { target: { value: "Что ты умеешь?" } });
    rerender([]);
    expect(textarea.value).toBe("Что ты умеешь?");
  });

  it("keeps the draft while the stored list is unchanged", () => {
    const { textarea, rerender } = renderList(["Первый", "Второй"]);
    fireEvent.change(textarea, { target: { value: "Первый\nВторой\nТретий" } });
    rerender(["Первый", "Второй"]);
    expect(textarea.value).toBe("Первый\nВторой\nТретий");
  });

  it("follows the stored list when it actually changes", () => {
    const { textarea, rerender } = renderList(["Первый"]);
    fireEvent.change(textarea, { target: { value: "черновик" } });
    rerender(["Первый", "Второй"]);
    expect(textarea.value).toBe("Первый\nВторой");
  });

  it("commits the parsed draft on blur", () => {
    const { textarea, onCommit } = renderList(["Первый"]);
    fireEvent.change(textarea, { target: { value: "Первый\n\nВторой\n" } });
    fireEvent.blur(textarea);
    expect(onCommit).toHaveBeenCalledWith(["Первый", "Второй"]);
  });

  it("does not commit an unchanged draft", () => {
    const { textarea, onCommit } = renderList(["Первый"]);
    fireEvent.blur(textarea);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
