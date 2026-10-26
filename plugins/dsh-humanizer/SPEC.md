# Humanizer tool plugin

## 1. Product contract

Host-only DeepSeek Harness plugin exposing dsh_humanize_text and dsh_humanizer_status. The operator runs a dedicated llama-server with jialinyyzz/humanizer; the plugin owns no model process, downloads, file writes, or automatic answer interception. Generated text is untrusted data for agent review. English and Chinese are documented upstream; other languages are experimental.

## 2. Configuration

enabled, endpoint (bare HTTP(S) origin), apiKey (or DSH_HUMANIZER_API_KEY), timeoutMs, maxInputBytes, maxChunkBytes, maxOutputTokens and maxOutputBytes. Secrets and draft/output contents never enter plugin logs. Endpoint is operator-controlled, never a tool argument. Redirects are refused. Limits are clamped and incoming drafts are rejected rather than silently truncated.

## 3. Verified API contract

llama-server GET /health, GET /props, POST /tokenize, POST /completion. Health reports ready/loading/unavailable without inference or exposing model filesystem paths. Tokenization reserves output tokens against the smaller of 8192 and server per-slot n_ctx before any generation. Request uses exact author prompt, temperature 1, top_p .95, top_k 0, min_p 0, repeat_penalty 1, EOS only. Model-specific prompt pinned to HF revision 7232532cb8466bd393544e97826e12e6b5e471ac; draft X has sha256 prefix cc51d66b4c593fbe.

## 4. Tools and degradation

dsh_humanize_text accepts text and optional protectedPhrases present in the trimmed draft. Splits at paragraph boundaries without slicing a paragraph, preserves separators between groups, processes sequentially. Formatting within a group may change. Fenced code is rejected; structured document conversion is outside v1. Oversized paragraphs or token budgets fail before completion. Reports rewrittenText, chunkCount, totalChunks, truncated and warnings. Checks number occurrence counts and protected phrase occurrences; these are heuristics, not semantic verification. Warns about detected Cyrillic or text without Latin/Han, and unexpected changed script; this does not identify every unsupported language. Stops on partial generation and surfaces truncation. All HTTP responses and final output are byte-bounded. Cancellation and disposal abort active requests; disposal unregisters tools. Disabled registers nothing. Transport/API errors use stable sanitized codes, without server body, credentials, URLs or text.

## 5. Verification

Config validation, exact prompt fingerprint, paragraph and preservation checks, real local HTTP integration through tool execution, token/context boundaries, health/loading/failure, limit flags (current and legacy), cancellation/disposal and registration. Run package lint/typecheck/test/build/verify and tarball checks. A fake server proves protocol integration only; real-model quality and deployed Host usage remain separately evidenced.

## 6. Distribution

Canonical metadata, English locale discovery, compatibility for the v0.2.0 branch, version plan. Publish source branch/PR only to Gitea for this task; no GitHub or registry release.
