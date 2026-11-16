/** Browser-safe defaults shared by the settings card and the host resolver. */
export const QUERY_MODES = [
  "local",
  "global",
  "hybrid",
  "naive",
  "mix",
  "bypass",
] as const;
export type QueryMode = (typeof QUERY_MODES)[number];

export interface ResolvedLightRagConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly queryMode: QueryMode;
  readonly queryTopK: number;
  readonly queryMaxAnswerBytes: number;
  readonly documentsMaxListed: number;
  readonly writesEnabled: boolean;
  readonly writesMaxTextBytes: number;
}

export const LIGHTRAG_DEFAULTS: ResolvedLightRagConfig = {
  enabled: true,
  endpoint: "http://127.0.0.1:9621",
  apiKey: "",
  timeoutMs: 60_000,
  queryMode: "mix",
  queryTopK: 20,
  queryMaxAnswerBytes: 200_000,
  documentsMaxListed: 200,
  writesEnabled: false,
  writesMaxTextBytes: 200_000,
};
