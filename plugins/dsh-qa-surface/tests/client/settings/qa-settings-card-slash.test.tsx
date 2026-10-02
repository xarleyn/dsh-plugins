// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { resolveConfig } from "../../../src/resolve-config.js";
import { renderCard, section, settle } from "./qa-settings-card.helpers.js";

afterEach(async () => {
  // The status poll settles after the assertions; flush it inside act so the
  // update is not reported as an unwrapped state change.
  await settle();
  cleanup();
});

describe("QA Surface card", () => {
  describe("slash section", () => {
    it("states that nothing below has an effect while the switch is off", async () => {
      await renderCard();
      expect(
        screen.getByTestId("qa-settings-slash-notice-disabled").textContent,
      ).toMatch(/Слэш-действия выключены/u);
    });

    it("writes the master switch through the lockdown path", async () => {
      const { mutate } = await renderCard();
      const slash = section("qa-settings-slash");
      fireEvent.click(
        within(slash).getByRole("checkbox", {
          name: /Разрешить слэш-действия/u,
        }),
      );
      await settle();
      expect(mutate).toHaveBeenCalledWith([
        { op: "set", path: ["lockdown", "allowSlashCommands"], value: true },
      ]);
    });

    it("keeps the allow list inert until its mode asks for one", async () => {
      await renderCard();
      // The default skills mode is allow-list, so its field is live; commands
      // default to deny-all and theirs is not.
      expect(
        (
          screen.getByTestId(
            "qa-settings-slash-skills-allow",
          ) as HTMLTextAreaElement
        ).disabled,
      ).toBe(false);
      expect(
        (
          screen.getByTestId(
            "qa-settings-slash-commands-allow",
          ) as HTMLTextAreaElement
        ).disabled,
      ).toBe(true);
    });

    it("warns about the legacy compatibility mode", async () => {
      await renderCard({
        describe: async () => ({
          ok: true as const,
          value: resolveConfig({
            lockdown: { allowSlashCommands: true },
          } as never),
        }),
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("qa-settings-slash-notice-legacy-defaults")
            .textContent,
        ).toMatch(/устаревший режим совместимости/u);
      });
    });
  });
});
