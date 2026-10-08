// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  QA_CHANGELOG,
  QA_VERSION,
} from "../../../src/client/components/QaChangelog.js";
import { QaSidebar } from "../../../src/client/components/QaSidebar.js";

type ReleaseBump = "patch" | "minor" | "major";

describe("sidebar version and changelog", () => {
  it("opens the changelog dialog from the footer version button", () => {
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
    expect(screen.queryByTestId("qa-surface-modal")).toBeNull();
    const version = screen.getByRole("button", { name: /Версия / });
    expect(version.textContent).toBe(`Версия ${QA_VERSION}`);
    fireEvent.click(version);
    const dialog = screen.getByTestId("qa-surface-modal");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: "История версий" })).toBeTruthy();
    expect(document.querySelectorAll(".dsh-qa-changelog__entry").length).toBe(
      QA_CHANGELOG.length,
    );
    expect(document.querySelectorAll(".dsh-qa-changelog__current").length).toBe(
      1,
    );
    // The changelog asks for the same wider panel the profile dialog uses;
    // its entries are full sentences and strand words at the default width.
    expect(screen.getByTestId("qa-surface-modal-panel").className).toContain(
      "dsh-qa-modal__panel--wide",
    );
    fireEvent.click(screen.getByTestId("qa-surface-modal-close"));
    expect(screen.queryByTestId("qa-surface-modal")).toBeNull();
  });

  it("does not draw a section heading with nothing under it", () => {
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
    const sectionsWithContent = QA_CHANGELOG.flatMap((entry) =>
      entry.sections.filter((section) =>
        section.items.some((item) => item.trim() !== ""),
      ),
    );
    const emptySections = QA_CHANGELOG.flatMap((entry) =>
      entry.sections.filter(
        (section) => !section.items.some((item) => item.trim() !== ""),
      ),
    );
    expect(
      document.querySelectorAll(".dsh-qa-changelog__section-title").length,
    ).toBe(sectionsWithContent.length);
    // The premise is real and unchangeable: `0.8.0` carries «Новое» with no
    // items, and a published section is frozen by scripts/verify-package-hygiene.mjs,
    // so the heading is the only half that can yield.
    expect(emptySections.length).toBeGreaterThan(0);
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
    expect(screen.queryByTestId("qa-surface-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(screen.getByTestId("qa-surface-modal"));
    expect(screen.queryByTestId("qa-surface-modal")).toBeNull();
    // A click inside the panel does not close the dialog.
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(screen.getByTestId("qa-surface-modal-panel"));
    expect(screen.getByTestId("qa-surface-modal")).toBeTruthy();
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
    const bundled = QA_CHANGELOG.slice(currentIndex);
    expect(bundled.map((entry) => entry.version)).toEqual(released);
    // The version list says nothing about content: an entry that declares no
    // section, or whose sections list no text, keeps this list green and
    // deploys a version heading with an empty body under it. Every released
    // version must have a curated entry that actually says something. One
    // section of a published entry may be empty — 0.8.0 lists «Новое» with
    // nothing under it — and that text is frozen by the wave that published
    // it, so the rule holds the entry, not every heading.
    for (const entry of bundled) {
      const items = entry.sections.flatMap((section) =>
        section.items.filter((item) => item.trim().length > 0),
      );
      expect(
        items.length,
        `QA_CHANGELOG entry ${entry.version} is released but says nothing: its ${
          entry.sections.length
        } section(s) carry no non-empty item`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the top of the bundled changelog on the version being released", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const plansDirectory = resolve(process.cwd(), "../../.nx/version-plans");
    const plans = await readdir(plansDirectory);
    const bumps: ReleaseBump[] = (
      await Promise.all(
        plans
          .filter((name) => name.endsWith(".md"))
          .map((name) => readFile(resolve(plansDirectory, name), "utf8")),
      )
    ).flatMap((plan) => {
      const match = /^"@yadsh\/dsh-qa-surface": (patch|minor|major)$/mu.exec(
        plan,
      );
      const bump = match?.[1];
      return bump === undefined ? [] : [bump as ReleaseBump];
    });

    const priority: Record<ReleaseBump, number> = {
      patch: 1,
      minor: 2,
      major: 3,
    };
    const bump = bumps.reduce<ReleaseBump | undefined>(
      (highest, candidate) =>
        highest === undefined || priority[candidate] > priority[highest]
          ? candidate
          : highest,
      undefined,
    );
    const [major = 0, minor = 0, patch = 0] = packageJson.version
      .split(".")
      .map((part) => Number(part));
    // Nothing plans a release of this package, so the newest curated section is
    // the version that is already out: an entry above it names a release no plan
    // asked for. `pnpm verify:packages` reports the same case from the plan side;
    // skipping this assertion while no plan was in flight left the test blind to
    // an entry that no wave would ever ship.
    const expected =
      bump === undefined
        ? packageJson.version
        : bump === "major"
          ? `${major + 1}.0.0`
          : bump === "minor"
            ? `${major}.${minor + 1}.0`
            : `${major}.${minor}.${patch + 1}`;
    expect(
      QA_CHANGELOG[0]?.version,
      `${QA_CHANGELOG[0]?.version} tops QA_CHANGELOG while ${
        bump === undefined
          ? `no version plan bumps the package past ${packageJson.version}`
          : `the live plans bump it to ${expected}`
      }`,
    ).toBe(expected);
  });
});
