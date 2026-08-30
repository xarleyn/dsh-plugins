export type ManagedPluginLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

export type ManagedPluginLogFormat = "json" | "text";

export interface PluginLogUiConfig {
  readonly defaultLevel?: ManagedPluginLogLevel;
  readonly format?: ManagedPluginLogFormat;
  readonly levels?: Readonly<Record<string, ManagedPluginLogLevel>>;
}

export interface ResolvedPluginLogUiConfig {
  readonly defaultLevel: ManagedPluginLogLevel;
  readonly format: ManagedPluginLogFormat;
  readonly levels: Readonly<Record<string, ManagedPluginLogLevel>>;
}

export interface PluginLogConsumerSnapshot {
  readonly pluginId: string;
  readonly level: ManagedPluginLogLevel;
  readonly format: ManagedPluginLogFormat;
  readonly instances: number;
}

export interface PluginLogUiSnapshot {
  readonly consumers: readonly PluginLogConsumerSnapshot[];
}

export interface PluginLogUiService {
  inspect(): PluginLogUiSnapshot;
  getConfig(): ResolvedPluginLogUiConfig;
}
