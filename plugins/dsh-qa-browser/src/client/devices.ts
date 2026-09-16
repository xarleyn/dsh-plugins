/**
 * The device toolbar's choices. Sizes stay inside {@link VIEWPORT_BOUNDS} so the
 * panel offers only what the Host would accept, and the bounds themselves live
 * with the Host's own clamp rather than being restated here.
 */

export interface BrowserDevicePreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const BROWSER_DEVICE_PRESETS: readonly BrowserDevicePreset[] = [
  { id: "laptop", label: "Ноутбук", width: 1_280, height: 720 },
  { id: "desktop", label: "Рабочий стол", width: 1_440, height: 900 },
  { id: "tablet", label: "Планшет", width: 834, height: 1_112 },
  { id: "phone", label: "Телефон", width: 390, height: 844 },
];

export interface BrowserScaleOption {
  readonly id: string;
  readonly label: string;
  /** `null` fits the whole viewport into the panel's stage. */
  readonly scale: number | null;
}

export const BROWSER_SCALES: readonly BrowserScaleOption[] = [
  { id: "fit", label: "По размеру окна", scale: null },
  { id: "1", label: "100 %", scale: 1 },
  { id: "0.75", label: "75 %", scale: 0.75 },
  { id: "0.5", label: "50 %", scale: 0.5 },
];
