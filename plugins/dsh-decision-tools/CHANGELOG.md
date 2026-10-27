## 0.1.1 (2026-10-27)

### 🩹 Fixes

- Build the workspace against DeepSeek Harness 0.2.1-rc.3 and widen the published Host support to the whole 0.1.7-to-0.3.0 line. ([2a16d478](https://github.com/xarleyn/dsh-plugins/commit/2a16d478))

  The dependency graph is made homogeneous rather than re-typed: the workspace root declares the 26 Host packages that peer resolution pulls in on its own as development roots through `catalog:dsh-dev`, that catalog gains the ten keys the set was missing, and every development pin moves to `0.2.1-rc.3`. Without those roots the same install keeps 26 packages at 0.1.7-rc.2 and reports conflicting peers, because a catalog entry only reaches a package some dependency edge actually names.

  Each package now declares `>=0.1.7-rc.2 <0.3.0-0` as its supported Host range. The ceiling is written as `-0` so that the host's `includePrerelease` comparison cannot let a release candidate of the next minor line inside it. `compatibility.json` keeps `testedReleases` at `0.1.7-rc.2`: the range says what is supported, the list says what was verified, and acceptance against a real 0.2.1-rc.3 host has not run yet.

  The lockfile is deduplicated as part of the same change, which the workspace dependency rules require.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-10-11)

### 🚀 Features

- Add independent agent tools for System One decisions, exclusive and multilabel classification, checklist checks, ordered ratings and candidate ranking. Configure named backends, preserve typed probability distributions and uncertainty, and bound input size, response size, concurrency, queue wait and cancellation without silently shortening context or selecting another provider. ([801828a0](https://github.com/xarleyn/dsh-plugins/commit/801828a0))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.2

### ❤️ Thank You

- xarleyn @xarleyn