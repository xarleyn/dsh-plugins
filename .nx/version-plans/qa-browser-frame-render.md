---
"@yadsh/dsh-qa-browser": patch
---

The browser panel's page preview renders again, and the panel stops
spamming frame requests.

The frame poll effect invalidated its own in-flight work: its cleanup
bumped the request sequence, while its dependency list contained the tabs
array — a fresh object on every poll — so the effect re-ran each tick and
every arriving `panelFrame` response was discarded as stale before it
reached the stage. The visible result was a panel frozen on «Получаем
изображение…» forever while the network log filled with half-megabyte PNG
responses nobody rendered.

The effect now depends on a boolean busy flag (any tab loading or the
panel holding the lease) instead of the array, and the cleanup no longer
bumps the sequence — superseded responses are still dropped by the
per-refresh guard, but a frame that settles after a re-run mounts. The
idle poll interval is raised from two to five seconds; the frame itself is
fetched only when the selected tab's revision changes, so an idle panel
costs one small `panelState` call instead of repeated image transfers. A
frame-carrying screencast channel remains the structural fix and stays a
documented non-goal of this release.
