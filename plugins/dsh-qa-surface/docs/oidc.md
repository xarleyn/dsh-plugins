# Corporate sign-in through OpenID Connect

QA Surface can authenticate through an OpenID Connect provider such as Keycloak.
Keycloak owns the AD/LDAP connection, login page, MFA and password policy. QA owns
its account IDs, conversations, sharing grants and tool access.

The integration uses Authorization Code with S256 PKCE. The server validates
discovery issuer, ID token signature through JWKS, audience, expiration, state and
nonce. Provider tokens and client secrets are never returned to the browser.

## Configure Keycloak

Create a dedicated OpenID Connect client in the realm already connected to AD.

1. Enable **Standard flow** and require **PKCE S256**. Disable implicit flow and
   direct access grants for this client.
2. Set **Valid redirect URIs** to the exact public callback, for example
   `https://qa.example.corp/qa/oidc/callback`. Avoid wildcard redirects.
3. Set **Valid post logout redirect URIs** to the public QA entry, for example
   `https://qa.example.corp/qa`.
4. For a confidential client, enable client authentication and put its secret in
   the Host process environment. QA uses `client_secret_basic`. A public client
   is also supported: leave `clientSecretEnv` empty and disable client authentication.
5. Include `sub`, `email`, `email_verified` and optionally `name` in the ID token.
   The integration requires `email_verified: true`; configure this claim according
   to your directory trust policy.
6. For admission and role mapping, include this client's roles in the signed
   **ID token**, under `resource_access.<clientId>.roles`. Default access-token role
   claims alone are insufficient. Enable **Add to ID token** on the client-role mapper.

AD groups can map to these client roles in Keycloak. QA does not import arbitrary
realm roles or LDAP groups. With no admin/reviewer mapping, every newly provisioned
corporate account is an ordinary user, including the first account.

## Configure QA Surface

Example entry in the deployment's Cordis patch:

```yaml
- id: qa-surface
  config:
    accounts:
      enabled: true
      localLogin: false
      allowRegistration: false
      oidc:
        enabled: true
        issuer: https://id.example.corp/realms/demo
        clientId: qa-surface
        clientSecretEnv: QA_OIDC_CLIENT_SECRET
        redirectUri: https://qa.example.corp/qa/oidc/callback
        buttonLabel: Войти корпоративной учётной записью
        autoProvision: true
        requiredRole: qa-access
        adminRole: qa-admin
        reviewerRole: qa-reviewer
        sessionTtlSeconds: 900
```

Set `QA_OIDC_CLIENT_SECRET` through the deployment's secret mechanism in the Host
process environment. Configuration contains only the variable's name. Do not put
its value in YAML, browser settings, source control or logs. For a private CA,
configure Node's trust store, for example with `NODE_EXTRA_CA_CERTS`; keep certificate
verification enabled.

Both issuer and callback require HTTPS. Use the exact discovery issuer, including
a trailing slash if declared. The callback pathname registers as an exact Host
route and must reach it through the proxy unchanged. If a proxy strips a path
prefix, adjust its routing to keep the configured callback pathname. The return
entry uses `route.path` on the callback's public origin.

The callback does not trust Host or Forwarded headers. Start sign-in from one
canonical public QA origin: the completion proof is scoped to that origin and the
initiating browser tab. Keep existing Host application-entry and transport
protection; OIDC identifies the QA account and does not replace the operator gate.

| Setting                  | Default | Behavior                                                                                                        |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------- |
| `accounts.localLogin`    | `true`  | Permit local password login and registration. `false` requires OIDC and rejects local tokens on the server too. |
| `oidc.enabled`           | `false` | Opt-in corporate sign-in; requires accounts enabled.                                                            |
| `oidc.autoProvision`     | `true`  | Create an account at first accepted corporate sign-in.                                                          |
| `oidc.requiredRole`      | empty   | Require this client role. Empty admits any authenticated identity with verified email.                          |
| `oidc.adminRole`         | empty   | Map this client role to QA administrator.                                                                       |
| `oidc.reviewerRole`      | empty   | Map this client role to QA reviewer. Administrator wins when both are present.                                  |
| `oidc.sessionTtlSeconds` | `900`   | QA session ceiling, 60–3600 seconds; ID token expiry can shorten it.                                            |

Keep `localLogin: true` for separate local operator accounts. An account linked
to OIDC cannot use a local password even when local login is enabled. Roles apply
on every corporate sign-in; admin mapping does not bypass capability assignments
or sharing policies.

## Link an existing QA account

Identity is keyed by `issuer + sub`. Email does not authorize account linking.
If a corporate email belongs to an unlinked QA account, sign-in refuses instead
of attaching conversations automatically.

After verifying the directory identity, the operator can attach it:

```sh
qa-accounts --file /path/to/qa-accounts.db link-oidc reader@example.com https://id.example.corp/realms/demo directory-subject
```

Take the subject from trusted provider administration or a verified identity,
not a self-declared profile. Linking retains the QA account ID, ownership, profile
and capability assignments, replaces the local password with unusable random
material, and revokes existing tokens. Subsequent sign-in updates the verified
email and display name without changing the account ID; a collision with another
QA email is refused. One corporate identity is attached per QA account.
With `autoProvision: false`, create and link accounts through the CLI beforehand.

## Session and logout behavior

The browser receives a short-lived QA token bound to a database session, stored
through the existing account controller. Provider access, refresh and ID tokens
stay on the server and are discarded after verification.

Login transactions expire after five minutes. The callback returns a single-use
opaque fragment valid for at most one minute. Completion requires the initiating
tab's sessionStorage proof and removes the fragment before remote work. A restart
or configuration change invalidates pending transactions.

Sign-out clears the browser QA token and asks the server to revoke its database
session. If the provider offers RP-Initiated Logout, QA redirects there with the
registered return URI. QA does not retain an ID token hint, so Keycloak may ask for
confirmation. If the server is unreachable, local sign-out still clears browser
state and token expiration remains the fallback.

This first integration does not store refresh tokens or implement automatic
renewal, backchannel logout or continuous AD synchronization. Provider access is
confirmed again at sign-in, which may reuse an existing SSO session. Provider-side
disable/role changes reach QA at reauthentication, subject to the provider's
directory and session policy. Already issued QA tokens can remain valid until
their short expiration. Provider logout alone does not immediately revoke every
QA session. Operator disable/revoke applies on the next authenticated QA operation;
a role change observed at sign-in invalidates older QA tokens.

## Acceptance on your deployment

Before enabling corporate-only mode, verify:

1. An allowed AD account signs in with its intended QA role and capability
   assignment; an account missing the required client role is refused.
2. A linked existing account retains its chats and profile. A matching email
   without explicit linking is refused.
3. Expired sessions return to the gate; repeated callbacks and handles fail.
   History and logs contain no provider tokens or secrets.
4. QA sign-out revokes its session; Keycloak logout returns to the configured
   entry. Check directory disable and role removal under your SSO policy.
5. Existing access/sharing checks still refuse other users' chats and tools.

Repository protocol tests use a synthetic provider with signed RSA ID tokens and
JWKS. They do not establish AD federation, proxy correctness, browser policies
or live realm admission; these checks require your deployment.
