# Humanizer tools for DeepSeek Harness

A host-only plugin that gives an agent two tools backed by a dedicated
[Humanizer](https://huggingface.co/jialinyyzz/humanizer) llama-server:

| Tool | Purpose |
| --- | --- |
| `dsh_humanize_text` | Rewrite a prose draft and return preservation warnings. |
| `dsh_humanizer_status` | Check server readiness and per-slot context without inference. |

The agent supplies a draft, reviews the returned text, and decides how to use it.
This plugin does not intercept every answer, download weights, start a server,
edit files, or send messages. It has no browser bundle or configuration card.

## Installation

This initial implementation is prepared on the DSH v0.2.0 development line.
A source branch or PR is not an npm release. Until a registry release exists,
build a local tarball from that checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-plugin-log build
pnpm --filter @yadsh/dsh-humanizer build
pnpm --filter @yadsh/dsh-humanizer pack --pack-destination ./dist
dsh plugin --profile web add <absolute-path-to-package.tgz>
```

The profile must supply the Host's `tools` service. If your deployment restricts
tools with an allow-list, grant the two names in the table explicitly.

## Start the model service

Follow the upstream
[installation and runtime guide](https://github.com/sgaofen/humanizer-local-model/blob/main/AGENTS.md).
Use a recent llama.cpp build compatible with the model. For example:

```sh
hf download jialinyyzz/humanizer humanizer-12b-Q8_0.gguf prompt_format.json --local-dir ./humanizer-model
llama-server -m ./humanizer-model/humanizer-12b-Q8_0.gguf -c 8192 -np 1 -ngl 99 --host 127.0.0.1 --port 8080
```

The Q8 file is about 12.7 GB; upstream recommends at least 32 GB of system
memory for it and offers smaller GGUF files. The actual GPU/CPU performance
and available memory must be checked on the deployment machine. The model
runs offline after its weights have been downloaded.

Use a dedicated server loaded with Humanizer. Readiness does not verify weight
identity or SHA. The plugin requires `/health`, `/props`, `/tokenize` and
`/completion`; a generic chat API alone is insufficient. Use an authenticated
HTTPS reverse proxy when the service is outside the Host machine.

## Configuration

Configuration belongs to the `dsh-humanizer` composition row in the selected
Host profile. For example, the row inserted by the plugin can carry:

```yaml
- id: dsh-humanizer
  name: "@yadsh/dsh-humanizer"
  config:
    endpoint: http://127.0.0.1:8080
    timeoutMs: 120000
    maxChunkBytes: 6000
    maxOutputTokens: 2048
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | When false, no tools are registered. |
| `endpoint` | `http://127.0.0.1:8080` | Bare HTTP(S) origin; no path, URL credentials, query or fragment. |
| `apiKey` | empty | Bearer key; empty falls back to `DSH_HUMANIZER_API_KEY`. |
| `timeoutMs` | `120000` | Overall call budget, including every group; clamped to 1000–900000 ms. Status is capped at 5000 ms. |
| `maxInputBytes` | `65536` | Total draft UTF-8 bytes; clamped to 1024–262144. |
| `maxChunkBytes` | `6000` | Maximum paragraph group bytes; clamped to 256–16384 and the input cap. |
| `maxOutputTokens` | `2048` | Generation token reservation per group; clamped to 128–4096. |
| `maxOutputBytes` | `131072` | Total returned text bytes; clamped to 1024–524288. |

Use the environment variable for deployment secrets; never put a real key in
a committed profile. Config changes take effect when the plugin is reapplied.

## Tool contract

Example arguments to `dsh_humanize_text`:

```json
{
  "text": "Demo Product shipped 12 units on 2026-10-12.",
  "protectedPhrases": ["Demo Product"]
}
```

`protectedPhrases` is optional. It accepts up to 32 exact strings, each present
in the draft and at most 512 characters long. These strings are checked after
generation; the model can still change them.

The tool returns:

- `rewrittenText`: generated text for review.
- `chunkCount` and `totalChunks`: groups processed and planned.
- `truncated`: true if generation stopped early, completion status was
  unconfirmed, or the returned text hit its byte cap.
- `warnings`: number/phrase mismatches, unexpected language, incomplete text,
  and a reminder to review meaning and facts.

Prose is grouped at blank-line boundaries without slicing a paragraph.
Separators between groups survive; the model may change formatting within a
group. Oversized drafts or individual paragraphs fail explicitly. Fenced code
blocks are rejected. For Markdown tables, links, code, DOCX or PDF, extract
the prose you intend to rewrite before calling this tool.

Before any inference, every prompt is tokenized by the loaded model. The
reserved output plus prompt must fit the smaller of 8192 and the server's
reported per-slot context. A smaller server context or a dense paragraph can
therefore require a smaller group or output reservation. Context is never
silently shifted to make a draft fit.

`dsh_humanizer_status` returns `status` (`ready`, `loading` or `unavailable`),
`contextTokens` (0 when unavailable/loading), and a sanitized `errorCode`.
Loading is a 503 health response; ready requires health and context checks.

## Quality limits

Upstream documents and evaluates English and Chinese. Russian and other
languages are experimental; this plugin reports that limitation for detected
Cyrillic and text without Latin/Han characters. Mixed languages and other
Latin-script languages are not reliably detected.

Number and exact phrase checks are heuristics. They do not establish factual
correctness or preserve units, names, dates, quotations or meaning. A clean
warning list cannot replace review, and a detector outcome is not guaranteed.
An incomplete result must not be presented as a full document.

## Security model

The endpoint is operator configuration, never an agent argument. Redirects
are refused, including redirects from completion requests. The entire draft
and returned text are sent to this service; choose its placement accordingly.

All HTTP responses are byte-bounded, including error responses. Transport
failures expose stable codes such as `UNAVAILABLE`, `TIMEOUT`, `HTTP_401`,
`INVALID_RESPONSE` or `CONTEXT_TOO_LARGE`, without echoing server bodies, URLs
or secrets. Caller cancellation and plugin disposal abort active requests.
Removing the plugin unregisters its tools.

Plugin logs contain only completion counts, sizes and warning counts, not
drafts, rewrites, phrases or keys. The Host may still journal tool arguments
and results under its normal session policy. Generated text is untrusted
data and must not be interpreted as instructions to execute.

## Compatibility

This implementation is developed and checked against DSH `0.2.0-rc.2` and
Cordis `4.0.4`, on the v0.2.0 branch. It requires `tools/register` and Node
`^22.19.0 || >=24.0.0`. There is no client module or Remote service.

Automated HTTP fixtures verify the integration protocol and lifecycle.
They do not measure real-model quality or deployed Host behavior.

## Development

```sh
pnpm --filter @yadsh/dsh-humanizer check
pnpm tarball:verify:packages plugins/dsh-humanizer
```

## License

Plugin code is MIT. The pinned Humanizer prompt is adapted from Apache-2.0
upstream material; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and
[LICENSE-APACHE-2.0](./LICENSE-APACHE-2.0). Weights are downloaded separately
and are not included in this package.
