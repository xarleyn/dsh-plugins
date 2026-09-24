// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  QA_CHANGELOG,
  QA_VERSION,
} from "../../../src/client/components/QaChangelog.js";
import { QaSidebar } from "../../../src/client/components/QaSidebar.js";
describe("sidebar version and changelog", () => {
  it("opens the changelog dialog from the footer version button", () => {
    const { container } = render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(container.querySelector(".dsh-qa-modal")).toBeNull();
    const version = screen.getByRole("button", { name: /Версия / });
    expect(version.textContent).toBe(`Версия ${QA_VERSION}`);
    fireEvent.click(version);
    const dialog = document.querySelector(".dsh-qa-modal") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("История версий")).toBeTruthy();
    expect(document.querySelectorAll(".dsh-qa-changelog__entry").length).toBe(
      QA_CHANGELOG.length,
    );
    expect(document.querySelectorAll(".dsh-qa-changelog__current").length).toBe(
      1,
    );
    // The changelog asks for the same wider panel the profile dialog uses;
    // its entries are full sentences and strand words at the default width.
    expect(document.querySelector(".dsh-qa-modal__panel--wide")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Закрыть историю версий"));
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
  });

  it("closes the changelog dialog on Escape and backdrop clicks", () => {
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(document.querySelector(".dsh-qa-modal") as HTMLElement);
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
    // A click inside the panel does not close the dialog.
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(
      document.querySelector(".dsh-qa-modal__panel") as HTMLElement,
    );
    expect(document.querySelector(".dsh-qa-modal")).toBeTruthy();
  });

  it("keeps the bundled version in sync with the package and changelog", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    // jsdom gives import.meta.url an http scheme; resolve from the package root.
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    expect(QA_VERSION).toBe(packageJson.version);
    const changelog = await readFile(
      resolve(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );
    const released = [
      // git-cliff releases use "## X.Y.Z (date)", the legacy header " - ".
      ...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?: \(| - )/gmu),
    ].map((match) => match[1] as string);
    const currentIndex = QA_CHANGELOG.findIndex(
      (entry) => entry.version === QA_VERSION,
    );
    expect(currentIndex).toBeGreaterThanOrEqual(0);
    expect(
      QA_CHANGELOG.slice(currentIndex).map((entry) => entry.version),
    ).toEqual(released);
  });

  it("keeps the next Nx-planned version at the top of the bundled changelog", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const plansDirectory = resolve(process.cwd(), "../../.nx/version-plans");
    const plans = await readdir(plansDirectory);
    const bumps = (
      await Promise.all(
        plans
          .filter((name) => name.endsWith(".md"))
          .map((name) => readFile(resolve(plansDirectory, name), "utf8")),
      )
    ).flatMap((plan) => {
      const match = /^"@yadsh\/dsh-qa-surface": (patch|minor|major)$/mu.exec(
        plan,
      );
      return match?.[1] === undefined ? [] : [match[1]];
    });
    if (bumps.length === 0) return;

    const priority = { patch: 1, minor: 2, major: 3 } as const;
    const bump = bumps.reduce((highest, candidate) =>
      priority[candidate as keyof typeof priority] >
      priority[highest as keyof typeof priority]
        ? candidate
        : highest,
    );
    const [major = 0, minor = 0, patch = 0] = packageJson.version
      .split(".")
      .map((part) => Number(part));
    const expected =
      bump === "major"
        ? `${major + 1}.0.0`
        : bump === "minor"
          ? `${major}.${minor + 1}.0`
          : `${major}.${minor}.${patch + 1}`;
    expect(QA_CHANGELOG[0]?.version).toBe(expected);
  });
});
