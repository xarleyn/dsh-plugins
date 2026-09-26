---
"@yadsh/dsh-qa-surface": patch
---

The chat, its message rows and its composer became addressable from a browser
run, so the surface can be driven without naming the Russian words it paints.

Every check of this surface had to say what it clicked in the operator's own
vocabulary: a test found the optimistic row by its `data-status`, the attachment
chip by the file name it renders, the running status by its copy, the pager of a
parked question by a CSS class. Copy is the least stable handle the surface
offers — it is localized, the composer hint changes with the phase of a turn, and
an answer's text is the one thing a run cannot know in advance. The browser round
of epic #453 asks for a second handle that survives both a copy edit and a
language switch.

The eight components of the transcript, the composer and the cards that park a
turn now carry `data-testid`: `qa-message` and its parts (`qa-message-content`,
`qa-message-actions`, `qa-message-meta`, `qa-message-pending`, the rating, copy
and regenerate controls), `qa-composer` and its parts (`qa-composer-input`,
`qa-composer-send`, `qa-composer-stop`, `qa-composer-attach`, `qa-composer-hint`
and the pending-attachment lists), `qa-turn-rail` with `qa-turn-rail-mark` on
every rung, `qa-question` and `qa-approval` for the two cards that wait on a
person, `qa-turn-notice` for the stack, `qa-variants` for the answer switcher and
`qa-file` for the attachment chip the composer and a sent message share. Values
are ASCII kebab-case and every zone keeps its own prefix. A repeated node carries
the value of its template rather than a number of its own — the rungs of the
ladder, the chips of one message and the lines of the stack all read alike, and
which one is meant stays the run's business, told apart by the accessible name or
the place in the list the node already offered.

Only attributes were added: no element moved, no class changed, and the sheet
still describes every box, so the surface looks and reads exactly as before. The
package's own checks moved to the new handles wherever they had used visible text
or a class as the locator — the metadata row, the byline, the attachment chip, the
composer hint and its hidden file input, the pager and the option list of a
question, the reason and the delegation mark of an approval, the lines of the
completion stack, the optimistic row on the whole surface — while every assertion
on a role or an accessible name stayed where it was, because those are the checks
that keep the surface usable without a screen.
