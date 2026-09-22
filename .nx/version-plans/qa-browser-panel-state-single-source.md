---
"@yadsh/dsh-qa-browser": patch
---

The Browser panel reads one state instead of agreeing with itself.

Three facts the panel showed could disagree with the state behind them, because
the render and the code that re-read the frame each worked them out separately:

- the address field synced from the selected tab in an effect, so it settled one
  flush after the frame it belonged to and could show the previous tab's URL
  (this is the drift that flaked on CI, patched then on the test side only);
- the frame memo remembered a revision without the tab it came from, and a
  revision is per tab, so two pages that were both never scrolled shared one
  number and switching between them kept the other page's image;
- the heartbeat interval was rebuilt whenever a poll advertised a different
  lease length, which ran the teardown that hands the page back — the operator
  lost a lease they were still holding.

All three are gone with the same change: the panel's derived view — the selected
tab, this panel's lease, the refusals with the entry that explains them, the
status line, the two control entries and the address — is computed once, in
`panel-view.ts`, from the polled state and the operator's own draft. The
container keeps what no pure function can own: the remotes, the polling, the
frame memo keyed by tab and revision, and the draft in the address field.

The status bar, the stage chip, the refusal banner and the address field render
exactly what they rendered before; what changed is that they can no longer
render a different answer than the one the panel acted on.
