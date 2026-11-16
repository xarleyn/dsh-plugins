---
"@yadsh/dsh-qa-surface": patch
---

Restore QA guidance and the filtered skill catalog immediately after history
compaction, including request preparation and overflow retries, and avoid
repeating unchanged clarification guidance across turns while preserving
turn-specific tool enforcement.

Keep document resend requests separate from editing or compound instructions,
preserve complete filenames, and select the updated artifact after mid-turn edits.
