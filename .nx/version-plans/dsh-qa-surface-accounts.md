---
"@yadsh/dsh-qa-surface": minor
---

Optional QA accounts and entry routing. `accounts.enabled` mounts a
full-frame login/registration gate (email + password, coarse audience-safe
refusals, per-store rate limiting, self-registration toggle) backed by
`$DSH_HOME/qa-accounts.json`: scrypt password hashes, a persisted HMAC secret
for stateful-expiry account tokens, and a session ownership map. Ownership is
first come, first served - attesting or bulk-claiming an unowned session binds
it to the caller (the migration path for existing per-browser chats on first
login); sessions owned by another user refuse attestation with
`session-owned-elsewhere` and stay hidden from the sidebar, admins are not
refused. The identity rides as an explicit token argument into the gated
`qaSurface` remotes (the typert carrier never exposes HTTP requests), the
policy admission checks it before any session fact is revealed
(`auth-required` reopens the gate on expiry), and the account chip with
logout lives in the sidebar footer. `entry.redirectNonLoopback` injects a
guarded head script through the `webserver/index-inject` event that continues
non-loopback hostnames into the QA route - the navigation-marker hand-off is
never redirected (no loops), `/?ui=admin` persists an operator bypass and
`/?ui=qa` clears it. Accounts are an identity layer for the QA surface, not a
harness boundary: QA users still hold the shared host launch-token cookie.
