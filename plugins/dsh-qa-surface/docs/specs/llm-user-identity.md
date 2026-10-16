# Per-account LLM request identity

One extended-provider route may serve all QA accounts with one shared credential. QA publishes a runtime-only `qaLlmIdentity.forSession(sessionId)` seam; this is not a Remote service and grants no tools, account access or credential selection.

Resolve only sessions the QA admission boundary attests and delegated children recorded by the existing ownership service. The persisted root chat owner is authoritative. A browser viewing another account's chat and participants in a shared chat do not replace that owner. Return no identity for unowned, unattested, account-free or disabled-owner requests. Resolve ownership and account status on each call.

The wire identifier is a stable, domain-separated SHA-256 pseudonym of the server-generated random account UUID, prefixed `qa_u_`. It contains no email, display name or raw account UUID, survives chat changes and application restarts, and differs across accounts. The owning root's verified children, compaction and title requests use the same pseudonym. Do not infer ownership from model-visible text or arbitrary client-provided tags.

The extended provider explicitly enables this mode per route, resolves and captures identity before any credential await, and sends the appropriate protocol field. Missing identity refuses the request rather than silently sharing an anonymous KV-cache partition. Routes with the mode disabled remain unchanged. The API key is not rotated or copied for each account.

DeepSeek's Chat Completions uses `user_id`; Anthropic-compatible Messages uses `metadata.user_id`; Responses uses `user`. This isolates provider-side user identity and KV-cache partitions according to the provider's contract. It does not create separate balances or independent account concurrency quotas. Validate the transmitted body with overlapping requests from two accounts and preserve unrelated metadata, messages, tools and shared credentials.

References: https://api-docs.deepseek.com/quick_start/rate_limit/ and https://api-docs.deepseek.com/guides/responses_api/ .
