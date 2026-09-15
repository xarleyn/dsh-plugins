export const QA_SURFACE_PANEL_SLOT = "qa.surface.panel" as const;

export type QaSurfacePanelOpenReason = "user" | "extension" | "activity";
export type QaSurfacePanelCloseReason = "user" | "extension";
export type QaSurfacePanelPresentation = "side" | "fullscreen";

export interface QaSurfacePanelDefinition {
  /** Globally unique implementation identity. Package names are preferred. */
  readonly id: string;
  /** Stable logical identity used by navigation. */
  readonly kind: string;
  /** User-facing, lazily localized title. */
  readonly title: () => string;
  readonly description?: () => string;
  /** Presentation token interpreted by QA Surface, never a React value. */
  readonly icon?: string;
  readonly order?: number;
  /** Defaults to true. Programmatic navigation remains available when false. */
  readonly userVisible?: boolean;
  /** Defaults to false. Hidden retained bodies stay mounted but inert. */
  readonly keepMounted?: boolean;
}

export interface QaSurfacePanelOpenOptions {
  readonly focus?: boolean;
  readonly params?: unknown;
  readonly reason?: QaSurfacePanelOpenReason;
}

export interface QaSurfacePanelOwnerProps {
  readonly panelId: string;
  readonly panelKind: string;
  readonly sessionId: string | null;
  /**
   * Current QA bearer credential for Host remotes that authorize access to
   * `sessionId`. Panel plugins must not persist, log, or place it in URLs.
   * Empty when QA accounts are disabled.
   */
  readonly qaToken: string;
  readonly visible: boolean;
  readonly presentation: QaSurfacePanelPresentation;
  readonly params: unknown;
  readonly actions: {
    close(): void;
    reveal(options?: { readonly focus?: boolean }): void;
  };
  /** Aborts with registration/body lifetime, never merely because it is hidden. */
  readonly signal: AbortSignal;
}

export interface QaSurfacePanels {
  register(definition: QaSurfacePanelDefinition): () => void;
  open(kind: string, options?: QaSurfacePanelOpenOptions): boolean;
  close(options?: { readonly reason?: QaSurfacePanelCloseReason }): void;
  toggle(kind: string): boolean;
  isRegistered(kind: string): boolean;
  getActiveKind(): string | null;
  list(): readonly QaSurfacePanelDefinition[];
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaSurfacePanels: QaSurfacePanels;
  }
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /**
     * QA Surface owns this keyed seat. Panel plugins register their body under
     * the exact `QaSurfacePanelDefinition.id` used by the metadata service.
     */
    "qa.surface.panel": {
      kind: "keyed";
      scope: "root";
      owner: QaSurfacePanelOwnerProps;
    };
  }
}
