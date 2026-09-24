// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QaSurfaceProps } from "../../../src/client/QaSurface.js";
import { QaSurfaceGuard } from "../../../src/client/QaSurfaceGuard.js";
import {
  QA_OVERLAY_STYLES,
  QA_ROOT_STYLES,
} from "../../../src/client/styles.js";

// The guard is the whole `shell.overlay` entry. A render crash inside the
// surface must be absorbed here and never reported to the host slot
// boundary: the host's per-entry isolation retires a crashed entry, and for
// this slot that would take the QA overlay down and leave the operator shell
// beneath it reachable.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QaSurfaceGuard", () => {
  it("absorbs a surface crash as the fullscreen failure card", () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // The empty face is what the slot inject hands over when its lazy host
    // service reads fail; the surface's first hook read throws into the
    // guard, which must swap in the failure card instead of propagating.
    render(<QaSurfaceGuard {...({} as QaSurfaceProps)} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Перезагрузить" })).toBeTruthy();
    expect(errors).toHaveBeenCalledWith(
      "dsh-qa-surface: surface render failed",
      expect.anything(),
    );
  });

  it("keeps covering the frame until the browser reloads", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(
      <QaSurfaceGuard {...({} as QaSurfaceProps)} />,
    );
    // The failure card reuses the surface root class: fixed, fullscreen,
    // opaque — the crash must not thin the overlay out into a partial page
    // where host chrome shows around it.
    const face = container.querySelector(".dsh-qa-crash.dsh-qa-surface");
    expect(face).toBeTruthy();
  });

  it("masks the host frame off the body attribute, not off the overlay node", () => {
    // Deleting the overlay element in the browser must reveal a blank page,
    // not the operator shell. The hiding rule therefore hangs on the body
    // attribute the surface effect owns (a div deletion cannot unset it) and
    // finds the frame structurally via the host's stable overlay-layer hook.
    // It belongs to the overlay sheet only: the kiosk sheet never carries a
    // host-hiding rule, because the kiosk composition never mounts the shell
    // the rule would hide.
    const mask = `body[data-dsh-qa-surface="active"] div:has(>[data-shell-overlay])>:not([data-shell-overlay]){display:none!important}`;
    expect(QA_OVERLAY_STYLES).toContain(mask);
    expect(QA_ROOT_STYLES).not.toContain(mask);
  });

  it("keeps the body mask attribute set while the surface is broken", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<QaSurfaceGuard {...({} as QaSurfaceProps)} />);
    // The mask attribute is owned by the guard, above the boundary: a crash
    // unmounts the surface, but must not lift the mask with it. With the
    // face missing, the route reads as permanently active — a broken surface
    // keeps the page masked. The boot flag lifts the proxy-injected boot
    // hide in the same synchronous block as the takeover.
    expect(document.body.dataset.dshQaSurface).toBe("active");
    expect(document.documentElement.dataset.dshQaBoot).toBe("done");
  });

  it("swaps the favicon to the branding logo while active, restoring on exit", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.head.innerHTML = '<link rel="icon" href="/host.ico">';
    const face = {
      config: {
        subscribe: () => () => undefined,
        getSnapshot: () => ({
          config: { branding: { logoUrl: "/qa-logo.svg" } },
        }),
      },
    } as unknown as QaSurfaceProps;
    const { unmount } = render(<QaSurfaceGuard {...face} />);
    expect(
      document
        .querySelector('link[data-dsh-qa-surface="favicon"]')
        ?.getAttribute("href"),
    ).toBe("/qa-logo.svg");
    unmount();
    expect(
      document.querySelector('link[data-dsh-qa-surface="favicon"]'),
    ).toBeNull();
    expect(
      document.querySelector('link[rel~="icon"]')?.getAttribute("href"),
    ).toBe("/host.ico");
  });
});
