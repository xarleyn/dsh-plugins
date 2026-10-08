// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaPasswordSettingsPage } from "../../../src/client/user-settings/PasswordSettingsPage.js";

/**
 * The password section of the settings dialog. A submit a browser would have
 * blocked on `required` reaches the page instead once the form opts out of
 * constraint validation, and what the operator reads is the page's own
 * sentence — so the opt-out and the copy are both pinned here.
 */
describe("QA password settings page", () => {
  function page() {
    const onChange = vi.fn(async () => null as string | null);
    render(<QaPasswordSettingsPage onChange={onChange} />);
    return { onChange };
  }

  function type(field: RegExp | string, value: string): void {
    fireEvent.change(screen.getByLabelText(field), { target: { value } });
  }

  function attempt(): void {
    fireEvent.submit(screen.getByTestId("qa-settings-password"));
  }

  it("keeps the browser's validator out of the form", () => {
    const { onChange } = page();
    const form = screen.getByTestId<HTMLFormElement>("qa-settings-password");
    expect(form.noValidate).toBe(true);
    expect(
      form.querySelector<HTMLInputElement>('input[name="new-password"]')
        ?.minLength,
    ).toBe(8);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says what an empty attempt is missing, in its own words", () => {
    const { onChange } = page();
    attempt();
    expect(
      screen.getByTestId("qa-settings-password-incomplete").textContent,
    ).toBe("Заполните все поля.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a new password below the Host's floor", () => {
    const { onChange } = page();
    type("Текущий пароль", "password-1");
    type("Новый пароль", "abc");
    type("Новый пароль ещё раз", "abc");
    attempt();
    expect(
      screen.getByTestId("qa-settings-password-too-short").textContent,
    ).toContain("не короче 8 символов");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a repeat that does not match", () => {
    const { onChange } = page();
    type("Текущий пароль", "password-1");
    type("Новый пароль", "password-2");
    type("Новый пароль ещё раз", "password-3");
    attempt();
    expect(
      screen.getByTestId("qa-settings-password-mismatch").textContent,
    ).toBe("Пароли не совпадают.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes the password once every field agrees", async () => {
    const { onChange } = page();
    type("Текущий пароль", "password-1");
    type("Новый пароль", "password-2");
    type("Новый пароль ещё раз", "password-2");
    expect(screen.queryByTestId("qa-settings-password-incomplete")).toBeNull();
    attempt();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("password-1", "password-2");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("qa-settings-password-saved").textContent,
      ).toContain("Пароль изменён");
    });
    // The saved form is empty again, and an empty form is not a complaint the
    // page should still be making.
    expect(screen.queryByTestId("qa-settings-password-incomplete")).toBeNull();
  });
});
