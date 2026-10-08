/**
 * The QA panel's browser: a live view of the page this chat's agent drives,
 * with the chrome of a browser around it. The pieces in `chrome.tsx` only draw
 * what this tree hands them.
 *
 * Two facts decide what the chrome may do, and they are deliberately separate:
 * the *lease* says who is driving, and the deployment's coordinate-input switch
 * says whether pointer gestures may be forwarded at all. Keys, text and scroll
 * follow the lease; clicks and context menus need both.
 *
 * What all of that resolves to — the selected tab, the lease owner, the
 * refusals, the address the field reads — is decided once, in `panel-view.ts`,
 * and consumed from there. The conversation with the runtime is its own module
 * twice over: `use-browser-session.ts` holds the poll, the frame memo and the
 * lease, `use-browser-commands.ts` every control that sends a call, and the
 * operator's own draft in the address field stays with the poll that must not
 * overwrite it. This file assembles the two into the chrome.
 */
import { useState } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { QA_SURFACE_PANEL_SLOT } from "@yadsh/dsh-qa-surface/client/panels";
import type { QaSurfacePanelOwnerProps } from "@yadsh/dsh-qa-surface/client/panels";
import type { TypertRemoteNamespace } from "@deepseek-ai/dsh-typert-protocol";

import { BrowserRefusals } from "./BrowserRefusals.js";
import {
  BrowserDeviceRow,
  BrowserMenu,
  BrowserStage,
  BrowserStatusBar,
  BrowserTabStrip,
  BrowserToolbar,
} from "./chrome.js";
import { BROWSER_SCALES } from "./devices.js";
import { useBrowserCommands } from "./use-browser-commands.js";
import { useBrowserSession } from "./use-browser-session.js";

export type BrowserPanelRemote = TypertRemoteNamespace<"qaBrowser">;

export interface BrowserPanelProps extends PropsRuntime<
  typeof QA_SURFACE_PANEL_SLOT
> {
  readonly browserRemote: BrowserPanelRemote;
}

export function BrowserPanel(props: BrowserPanelProps) {
  const owner: QaSurfacePanelOwnerProps = props;
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scaleId, setScaleId] = useState("fit");

  const {
    clientId,
    error,
    frame,
    refresh,
    runRemote,
    setAddressDraft,
    setError,
    state,
    view,
  } = useBrowserSession({
    browserRemote: props.browserRemote,
    owner,
  });

  const coordinateInputEnabled = state?.coordinateInputEnabled === true;
  const commands = useBrowserCommands({
    browserRemote: props.browserRemote,
    clientId,
    coordinateInputEnabled,
    owner,
    refresh,
    runRemote,
    setError,
    view,
  });

  const { refusals, selected, session } = view;
  const interactive = view.canDrive;
  const scale = BROWSER_SCALES.find((option) => option.id === scaleId)?.scale;

  /** The status-bar chip, resolved once for the JSX below. */
  const chip = view.chipControl;

  if (owner.sessionId === null) {
    return (
      <div
        className="dsh-qa-browser-panel__empty"
        data-testid="panel-empty"
        role="status"
      >
        Откройте или создайте чат, чтобы связать Browser с QA-сессией.
      </div>
    );
  }

  const frameView =
    frame === null
      ? null
      : {
          src: `data:${frame.mediaType};base64,${frame.data}`,
          alt: `Страница Browser: ${frame.title || frame.url}`,
        };

  return (
    <section
      className="dsh-qa-browser-panel"
      data-testid="panel-root"
      aria-label="Browser"
    >
      <BrowserTabStrip
        tabs={state?.tabs ?? []}
        selectedId={session?.selectedTabId ?? null}
        interactive={interactive}
        onSelect={commands.selectTab}
        onClose={commands.closeTab}
        onNewTab={commands.openTab}
      />
      <div className="dsh-qa-browser-panel__bar" data-testid="panel-bar">
        <BrowserToolbar
          address={view.address}
          editable={interactive && selected !== undefined}
          canGoBack={(selected?.history.back ?? 0) > 0}
          canGoForward={(selected?.history.forward ?? 0) > 0}
          deviceOpen={deviceOpen}
          menuOpen={menuOpen}
          onAddressChange={(value) => {
            // Typing starts an edit and owns the field until the operator
            // leaves it: nothing a poll delivers may overwrite half a URL.
            setAddressDraft({ editing: true, value });
          }}
          onAddressFocus={() => {
            setAddressDraft((draft) => ({ ...draft, editing: true }));
          }}
          onAddressBlur={() => {
            setAddressDraft({ editing: false, value: null });
          }}
          onAddressSubmit={commands.submitAddress}
          onBack={() => commands.history("back")}
          onForward={() => commands.history("forward")}
          onReload={() => commands.history("reload")}
          onToggleDevice={() => setDeviceOpen((open) => !open)}
          onToggleMenu={() => setMenuOpen((open) => !open)}
        />
        {deviceOpen && selected !== undefined ? (
          <BrowserDeviceRow
            viewport={selected.viewport}
            scaleId={scaleId}
            interactive={interactive}
            onResize={commands.resize}
            onPreset={(preset) => commands.resize(preset.width, preset.height)}
            onScale={setScaleId}
          />
        ) : null}
        {menuOpen ? (
          <BrowserMenu
            items={commands.menuItems}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}
      </div>
      <BrowserStage
        frame={frameView}
        busy={selected?.status === "loading"}
        emptyMessage={view.emptyMessage}
        viewport={view.viewport}
        scale={scale ?? null}
        interactive={interactive}
        coordinateInputEnabled={coordinateInputEnabled}
        // The page is driven by whoever holds the lease, which may be another
        // panel: the chip reports the session, not this pane.
        ownerLabel={view.ownerLabel}
        onStageRef={commands.bindStage}
        onImageClick={(event) => commands.pointer(event, "left")}
        onImageContextMenu={(event) => {
          if (!interactive) return;
          event.preventDefault();
          commands.pointer(event, "right");
        }}
        onKeyDown={commands.keyDown}
        onPaste={commands.paste}
        onWheel={commands.wheel}
      />
      {view.refusalHeadline === null ? null : (
        <BrowserRefusals
          headline={view.refusalHeadline}
          leadMessage={view.leadRefusal?.message}
          refusals={refusals}
        />
      )}
      <BrowserStatusBar
        status={view.statusLine}
        viewport={selected?.viewport ?? null}
        tabCount={view.tabCount}
        control={
          chip === null
            ? null
            : {
                label: chip.label,
                disabled: chip.disabled,
                onSelect: () => {
                  if (chip.action === "release") commands.releaseControl();
                  else commands.takeControl();
                },
              }
        }
      />
      {error === null ? null : (
        <div
          className="dsh-qa-browser-panel__error"
          data-testid="panel-error"
          role="alert"
        >
          {error}
        </div>
      )}
    </section>
  );
}
