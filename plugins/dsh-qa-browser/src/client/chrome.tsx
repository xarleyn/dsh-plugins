/**
 * The browser chrome's pieces. Everything here is presentational: the panel
 * container owns the lease, the polling and the remotes, and hands each piece
 * the few facts it draws. Class names keep the panel's single prefix so the
 * stylesheet stays one place.
 */
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";

import type { BrowserPanelTab } from "../types.js";
import {
  BROWSER_DEVICE_PRESETS,
  BROWSER_SCALES,
  type BrowserDevicePreset,
} from "./devices.js";
import { pageLabel } from "./url.js";
import { VIEWPORT_BOUNDS } from "../host/viewport.js";

type PanelTab = BrowserPanelTab;

/** «1 вкладка», «2 вкладки», «5 вкладок» — the count the footer reports. */
export function tabCountLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) return `${count} вкладка`;
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) {
    return `${count} вкладки`;
  }
  return `${count} вкладок`;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="m3 3 6 6m0-6-6 6" />
    </svg>
  );
}

function ChevronIcon({
  direction,
}: {
  readonly direction: "back" | "forward";
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {direction === "back" ? (
        <path d="M10 3 5 8l5 5" />
      ) : (
        <path d="M6 3l5 5-5 5" />
      )}
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.6-3.67M13 2.5V5.2h-2.7" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="2.5" width="7" height="11" rx="1.5" />
      <path d="M7 11.5h2" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.4" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.6" cy="8" r="1" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.5 1.5 2.3 3.4 2.3 5.5S9.5 12 8 13.5C6.5 12 5.7 10.1 5.7 8S6.5 4 8 2.5Z" />
    </svg>
  );
}

export interface BrowserTabStripProps {
  readonly tabs: readonly PanelTab[];
  readonly selectedId: string | null;
  /** The strip follows the lease: without it, tabs are a roster, not controls. */
  readonly interactive: boolean;
  readonly onSelect: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onNewTab: () => void;
}

/** The tab strip: one tab per page, the way a browser draws them. */
export function BrowserTabStrip({
  tabs,
  selectedId,
  interactive,
  onSelect,
  onClose,
  onNewTab,
}: BrowserTabStripProps) {
  return (
    <div
      className="dsh-qa-browser-panel__tabs"
      role="tablist"
      aria-label="Вкладки Browser"
    >
      {tabs.map((tab) => {
        const active = tab.id === selectedId;
        const label = pageLabel(tab.title, tab.url);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className="dsh-qa-browser-panel__tab"
            title={tab.url === "" ? label : tab.url}
            onClick={() => {
              if (interactive) onSelect(tab.id);
            }}
            onKeyDown={(event) => {
              if (!interactive) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect(tab.id);
            }}
          >
            <span className="dsh-qa-browser-panel__tab-icon" aria-hidden="true">
              {tab.status === "loading" ? (
                <span className="dsh-qa-browser-panel__tab-spinner" />
              ) : (
                <span className="dsh-qa-browser-panel__tab-dot" />
              )}
            </span>
            <span className="dsh-qa-browser-panel__tab-label">{label}</span>
            <button
              type="button"
              className="dsh-qa-browser-panel__tab-close"
              aria-label={`Закрыть вкладку: ${label}`}
              disabled={!interactive}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="dsh-qa-browser-panel__newtab"
        aria-label="Новая вкладка"
        title="Новая вкладка"
        disabled={!interactive}
        onClick={onNewTab}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2.5v7M2.5 6h7" />
        </svg>
      </button>
    </div>
  );
}

export interface BrowserToolbarProps {
  readonly address: string;
  readonly editable: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly deviceOpen: boolean;
  readonly menuOpen: boolean;
  readonly onAddressChange: (value: string) => void;
  readonly onAddressFocus: () => void;
  readonly onAddressBlur: () => void;
  readonly onAddressSubmit: () => void;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onReload: () => void;
  readonly onToggleDevice: () => void;
  readonly onToggleMenu: () => void;
}

/** Navigation, the address field and the two tool toggles. */
export function BrowserToolbar({
  address,
  editable,
  canGoBack,
  canGoForward,
  deviceOpen,
  menuOpen,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onAddressSubmit,
  onBack,
  onForward,
  onReload,
  onToggleDevice,
  onToggleMenu,
}: BrowserToolbarProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAddressSubmit();
  };
  return (
    <div className="dsh-qa-browser-panel__toolbar">
      <button
        type="button"
        className="dsh-qa-browser-panel__nav"
        aria-label="Назад"
        disabled={!editable || !canGoBack}
        onClick={onBack}
      >
        <ChevronIcon direction="back" />
      </button>
      <button
        type="button"
        className="dsh-qa-browser-panel__nav"
        aria-label="Вперёд"
        disabled={!editable || !canGoForward}
        onClick={onForward}
      >
        <ChevronIcon direction="forward" />
      </button>
      <button
        type="button"
        className="dsh-qa-browser-panel__nav"
        aria-label="Перезагрузить страницу"
        disabled={!editable}
        onClick={onReload}
      >
        <ReloadIcon />
      </button>
      <form className="dsh-qa-browser-panel__omni" onSubmit={submit}>
        <span className="dsh-qa-browser-panel__address-icon" aria-hidden="true">
          <GlobeIcon />
        </span>
        <input
          className="dsh-qa-browser-panel__address"
          aria-label="Адрес Browser"
          spellCheck={false}
          autoComplete="off"
          readOnly={!editable}
          value={address}
          placeholder="Введите адрес"
          onChange={(event) => onAddressChange(event.currentTarget.value)}
          onFocus={(event) => {
            event.currentTarget.select();
            onAddressFocus();
          }}
          onBlur={onAddressBlur}
        />
      </form>
      <button
        type="button"
        className={
          deviceOpen
            ? "dsh-qa-browser-panel__tool dsh-qa-browser-panel__tool--on"
            : "dsh-qa-browser-panel__tool"
        }
        aria-label="Устройство"
        aria-pressed={deviceOpen}
        title="Размер устройства"
        onClick={onToggleDevice}
      >
        <DeviceIcon />
      </button>
      <button
        type="button"
        className={
          menuOpen
            ? "dsh-qa-browser-panel__tool dsh-qa-browser-panel__tool--on"
            : "dsh-qa-browser-panel__tool"
        }
        aria-label="Действия Browser"
        aria-expanded={menuOpen}
        onClick={onToggleMenu}
      >
        <MenuIcon />
      </button>
    </div>
  );
}

export interface BrowserDeviceRowProps {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scaleId: string;
  readonly interactive: boolean;
  readonly onResize: (width: number, height: number) => void;
  readonly onPreset: (preset: BrowserDevicePreset) => void;
  readonly onScale: (scaleId: string) => void;
}

/**
 * The device toolbar: an exact size, a preset, and how much of it the pane
 * shows. Sizes commit on blur or Enter — a viewport change per keystroke would
 * re-lay-out the page behind it on every digit.
 */
export function BrowserDeviceRow({
  viewport,
  scaleId,
  interactive,
  onResize,
  onPreset,
  onScale,
}: BrowserDeviceRowProps) {
  const [draft, setDraft] = useState({
    width: String(viewport.width),
    height: String(viewport.height),
  });
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft({
      width: String(viewport.width),
      height: String(viewport.height),
    });
  }, [editing, viewport.height, viewport.width]);

  const commit = () => {
    setEditing(false);
    const width = Number.parseInt(draft.width, 10);
    const height = Number.parseInt(draft.height, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      setDraft({
        width: String(viewport.width),
        height: String(viewport.height),
      });
      return;
    }
    if (width === viewport.width && height === viewport.height) return;
    onResize(width, height);
  };

  const preset = BROWSER_DEVICE_PRESETS.find(
    (candidate) =>
      candidate.width === viewport.width &&
      candidate.height === viewport.height,
  );

  return (
    <div className="dsh-qa-browser-panel__device">
      <div className="dsh-qa-browser-panel__device-size">
        <input
          className="dsh-qa-browser-panel__device-field"
          type="number"
          inputMode="numeric"
          aria-label="Ширина вьюпорта"
          min={VIEWPORT_BOUNDS.width.min}
          max={VIEWPORT_BOUNDS.width.max}
          value={draft.width}
          disabled={!interactive}
          onChange={(event) => {
            // Read the value before the state update: React clears the
            // synthetic event's target, and the updater runs later.
            const value = event.currentTarget.value;
            setEditing(true);
            setDraft((current) => ({
              ...current,
              width: value,
            }));
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <span aria-hidden="true">×</span>
        <input
          className="dsh-qa-browser-panel__device-field"
          type="number"
          inputMode="numeric"
          aria-label="Высота вьюпорта"
          min={VIEWPORT_BOUNDS.height.min}
          max={VIEWPORT_BOUNDS.height.max}
          value={draft.height}
          disabled={!interactive}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setEditing(true);
            setDraft((current) => ({
              ...current,
              height: value,
            }));
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      </div>
      <label className="dsh-qa-browser-panel__device-pick">
        <span className="dsh-qa-browser-panel__sr-only">Устройство</span>
        <select
          aria-label="Устройство"
          value={preset?.id ?? "custom"}
          disabled={!interactive}
          onChange={(event) => {
            const next = BROWSER_DEVICE_PRESETS.find(
              (candidate) => candidate.id === event.currentTarget.value,
            );
            if (next !== undefined) onPreset(next);
          }}
        >
          <option value="custom">Свой размер</option>
          {BROWSER_DEVICE_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <label className="dsh-qa-browser-panel__device-pick">
        <span className="dsh-qa-browser-panel__sr-only">Масштаб</span>
        <select
          aria-label="Масштаб"
          value={scaleId}
          onChange={(event) => onScale(event.currentTarget.value)}
        >
          {BROWSER_SCALES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export interface BrowserStageProps {
  readonly frame: { readonly src: string; readonly alt: string } | null;
  readonly busy: boolean;
  readonly emptyMessage: string;
  readonly viewport: { readonly width: number; readonly height: number };
  /** Pixels per page pixel, or null to fit the whole page into the pane. */
  readonly scale: number | null;
  readonly interactive: boolean;
  readonly coordinateInputEnabled: boolean;
  readonly ownerLabel: string;
  /**
   * Receives the scrolling pane's element, so the container can hand it the
   * keyboard after a click. A callback rather than a ref object: the React
   * types in this workspace come from two generations, and a callback ref is
   * what both of them agree on.
   */
  readonly onStageRef?: (node: HTMLDivElement | null) => void;
  readonly onImageClick: (event: MouseEvent<HTMLImageElement>) => void;
  readonly onImageContextMenu: (event: MouseEvent<HTMLImageElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  readonly onWheel: (event: WheelEvent<HTMLElement>) => void;
}

/** The page itself, with the two chips that explain who is in charge. */
export function BrowserStage({
  frame,
  busy,
  emptyMessage,
  viewport,
  scale,
  interactive,
  coordinateInputEnabled,
  ownerLabel,
  onStageRef,
  onImageClick,
  onImageContextMenu,
  onKeyDown,
  onPaste,
  onWheel,
}: BrowserStageProps) {
  const fixed =
    scale === null
      ? null
      : {
          width: `${Math.round(viewport.width * scale)}px`,
          height: `${Math.round(viewport.height * scale)}px`,
        };
  return (
    <div
      className="dsh-qa-browser-panel__stage"
      ref={onStageRef}
      tabIndex={interactive ? 0 : -1}
      aria-label={
        interactive ? "Интерактивное окно Browser" : "Предпросмотр Browser"
      }
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onWheel={onWheel}
    >
      <div className="dsh-qa-browser-panel__canvas-scroll">
        <div
          className={
            fixed === null
              ? "dsh-qa-browser-panel__canvas dsh-qa-browser-panel__canvas--fit"
              : "dsh-qa-browser-panel__canvas"
          }
          style={fixed ?? undefined}
        >
          {frame === null ? (
            <div className="dsh-qa-browser-panel__empty" role="status">
              {emptyMessage}
            </div>
          ) : (
            <img
              className={
                interactive
                  ? "dsh-qa-browser-panel__page dsh-qa-browser-panel__page--live"
                  : "dsh-qa-browser-panel__page"
              }
              src={frame.src}
              alt={frame.alt}
              draggable={false}
              onClick={onImageClick}
              onContextMenu={onImageContextMenu}
            />
          )}
        </div>
      </div>
      {frame === null ? null : (
        <span
          className={
            interactive
              ? "dsh-qa-browser-panel__chip dsh-qa-browser-panel__chip--human"
              : "dsh-qa-browser-panel__chip"
          }
          role="status"
        >
          {interactive && !coordinateInputEnabled
            ? "Ввод мышью отключён в настройках стенда"
            : ownerLabel}
        </span>
      )}
      {busy ? (
        <span className="dsh-qa-browser-panel__progress" role="status">
          <span className="dsh-qa-browser-panel__sr-only">
            Обновляем изображение
          </span>
        </span>
      ) : null}
    </div>
  );
}

export interface BrowserMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/** The `⋯` popover: everything that does not deserve a permanent button. */
export function BrowserMenu({
  items,
  onClose,
}: {
  readonly items: readonly BrowserMenuItem[];
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (ref.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="dsh-qa-browser-panel__menu" role="menu" ref={ref}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="dsh-qa-browser-panel__menu-item"
          disabled={item.disabled === true}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface BrowserStatusBarProps {
  readonly status: string;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly tabCount: number;
  readonly control: {
    readonly label: string;
    readonly disabled: boolean;
    readonly onSelect: () => void;
  } | null;
}

/** The bottom line: who drives, how big the page is, and the lease control. */
export function BrowserStatusBar({
  status,
  viewport,
  tabCount,
  control,
}: BrowserStatusBarProps) {
  return (
    <footer className="dsh-qa-browser-panel__status">
      <span>{status}</span>
      <div className="dsh-qa-browser-panel__status-actions">
        {viewport === null ? null : (
          <span>
            {viewport.width}×{viewport.height}
          </span>
        )}
        <span>{tabCountLabel(tabCount)}</span>
        {control === null ? null : (
          <button
            type="button"
            className="dsh-qa-browser-panel__control"
            disabled={control.disabled}
            onClick={control.onSelect}
          >
            {control.label}
          </button>
        )}
      </div>
    </footer>
  );
}
