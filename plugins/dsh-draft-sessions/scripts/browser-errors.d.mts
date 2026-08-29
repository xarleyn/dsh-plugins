export interface BrowserErrorRecord {
  message: string;
  duringHostOutage: boolean;
}

export function isExpectedBrowserError(error: BrowserErrorRecord): boolean;
