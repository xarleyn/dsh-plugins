# Configuration reference

Defaults and constraints are documented in the root README. Important runtime
rules are:

- `route.path` starts with `/`, has trailing slashes removed, and cannot claim
  `/`, `/api` or `/plugins`;
- `fixed` requires `fixedSessionId`;
- `provider` and `model` are either both absent or both present;
- `maxContentWidth` is an integer from 480 through 1600;
- duplicate/blank suggested questions are removed;
- approval and question policies are fixed to safe blocking behavior;
- reasoning display cannot be enabled in the 0.1.x MVP.

Browser persistence stores only the DSH session id under
`<storageKey>:v1:<route>:session`. Transcript content, credentials and tool
results remain in the Host-owned DSH Session and are never copied to browser
storage.
