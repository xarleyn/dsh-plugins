---
"@yadsh/dsh-session-scope": patch
---

The browser client is several modules now, and nothing the shell sees changes.

`src/client.ts` was one 1429-line file holding everything the client renders and
all of the transport it uses. It is now a `src/client/` directory built by the
same tsdown entry: `index.ts` keeps what only a mounted plugin instance can own —
the Remote `$mount`, the durable `/scope` write, the read RPC, the composer seat
and the blank-session hero portal — while the copy, the stylesheet, the icons,
the path-comparison rules and the client half of the Remote contract each got
their own module, and the scope editor was separated into the draft state and
commands (`scope-editor.ts`) and the rendering of the modal
(`scope-editor-view.ts`). The largest client module is 400 lines.

Nothing observable moved. The bundle is still generated rather than authored,
still registers exactly `@yadsh/dsh-session-scope`, still takes `react` and
`react-dom` as shell statics, still contributes the Scope chip to the composer's
left seat, still resolves the workspace root from the sessions store and falls
back to the `session-scope` projection, and still reads one directory level
through the dedicated non-durable `sessionScope/list` RPC instead of a slash
command. `verify:client` asserts those shapes in the built artifact and runs the
registration against a module-loader stub, and the client tests still mount the
chip through a fake React; every string the client renders survived the move
verbatim.

Two boundaries became explicit instead of implicit. The editor no longer closes
over the transport — it is handed `runCommand` and `listLevel` as props, so what
a draft is saved through is visible where the editor starts. And clearing every
pending row is a named action of the editor rather than a raw state patch
written in the middle of the render tree, which is the one place the render had
been reaching into state.
