# Offline inventory for local file attachments

Run the command against a stopped, complete local QA profile or a consistent offline copy. `--offline` confirms that the Host and other writers are stopped and that the profile uses the standard local storage paths. Pass the absolute `DSH_HOME` explicitly. The repository's Node version and the .NET 10 SDK or later must be on `PATH`. Redirect the report outside the profile if you want to save it.

```sh
dotnet run --file scripts/qa-attachments-dry-run.cs -- --offline --home /absolute/path/to/dsh-home
```

The command reads files and writes a JSON report to stdout. Its exit codes are `0` for a complete inventory, `2` for invalid arguments, and `3` for an incomplete inventory. A report with `complete: false` always has an empty `candidates` list and zero `candidateLogicalBytes`. See `blockers` for the failing stages and profile-relative paths.

## What protects a file

- The scanner reads every session journal under `sessions/<project>/<session>/`, including delegated sessions and forks. It reads plain JSONL and all checksummed Zstandard frames of the self-contained v4 format used by Harness `0.2.2-rc.3`. A seeded journal retains the references in its inherited events even after its parent is gone.
- For QA Forms schema 1, it reads all form documents, including upload receipts and submissions, all mutation results, and the SHA-256 of every stored resource. Superseded versions can remain reachable through these records. A profile where QA Forms has never initialized may have no forms database. A database with pending recovery sidecars blocks the report. SQLite opens the main database in immutable, read-only mode.
- The scanner also reads the live QA provenance JSON and per-session shards, when present. In JSON sources, any standalone 64-character hexadecimal digest in a string or key protects the matching group. This includes typed references, attachment paths in tool results, and literal digests in saved text.

## How to read the candidates

Each group consists of one canonical object in `attachments/v1/file-objects` and its filename hard links in `attachments/v1/files`. The scanner checks the links against filesystem identity and verifies the digest of each candidate's content. `candidateLogicalBytes` counts the canonical object's length once, regardless of the number of aliases.

A group is a candidate when the inventory is complete, there is no matching reference, and the object's modification time is at least seven days before the scan started. `--min-age-days N` overrides this grace period. `kept` shows the reference sources or the age rule that protected each listed group.

Unknown journal or storage layouts, incomplete frames or JSONL records, a pending session purge, staged attachments, unaccounted hard links, and detected changes during the scan block candidates for the entire profile. A journal with only a header also blocks candidates because an empty session and a history cut down to its header look the same on disk. The Zstandard decoder caps each frame at 64 MiB compressed and 128 MiB decoded.

The inventory covers only the standard local session, QA Forms, provenance, and file attachment stores. An alternate backend, an incomplete profile copy, or a plugin that persists file references elsewhere requires its own inventory. A missing journal or a history shortened at a valid record boundary can be indistinguishable from the intended state without an independent manifest.

The report is advisory and describes the stopped profile at scan time. It includes profile-relative paths and display filenames, so handle it as profile data. Images, request-image caches, SQLite resources, and backup copies are outside the candidate set. The command has no apply mode.
