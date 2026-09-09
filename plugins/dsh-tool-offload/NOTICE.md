# NOTICE

`dsh-tool-offload` is inspired by Spotify's
[`portal-ai-plugins/shunt`](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt),
which routes I/O-heavy work to cheaper worker models.

`shunt` established the core idea this plugin is built on:

- keep the decision about *which* tool to call and with which arguments with the
  main/frontier agent;
- send only the *processing* of large, low-judgement tool results to a small,
  cheap worker model;
- return a compact model-facing result so the expensive context stays small.

`dsh-tool-offload` is an independent DeepSeek Harness-native implementation. It
does not require Spotify Portal or AiKA, and no source code was copied from
`shunt`; the routing policy, payload construction, worker orchestration, and
safety guards are original to this repository and use DeepSeek Harness
extension points (`tools/post-execute`, `ctx.subagents`). Because no source was
copied, no additional license text beyond the credit in `README.md` and this
notice is required; both are kept as a courtesy and for clarity.
