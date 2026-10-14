/** Server OIDC configuration. Secrets are referenced by environment name only. */
export interface QaOidcConfig {
  readonly enabled?: boolean;
  readonly issuer?: string;
  readonly clientId?: string;
  readonly clientSecretEnv?: string;
  /** Exact public HTTPS callback URL, including any reverse proxy prefix. */
  readonly redirectUri?: string;
  readonly buttonLabel?: string;
  readonly autoProvision?: boolean;
  /** Client roles included in the signed ID token's resource_access claim. */
  readonly requiredRole?: string;
  readonly adminRole?: string;
  readonly reviewerRole?: string;
  /** Upper bound on QA access before another OIDC authentication. */
  readonly sessionTtlSeconds?: number;
}

export interface ResolvedQaOidcConfig {
  readonly enabled: boolean;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecretEnv: string;
  readonly redirectUri: string;
  readonly buttonLabel: string;
  readonly autoProvision: boolean;
  readonly requiredRole: string;
  readonly adminRole: string;
  readonly reviewerRole: string;
  readonly sessionTtlSeconds: number;
}

/** The browser retains completionKey in sessionStorage before leaving QA. */
export interface QaOidcStart {
  readonly authorizationUrl: string;
  readonly completionKey: string;
}
