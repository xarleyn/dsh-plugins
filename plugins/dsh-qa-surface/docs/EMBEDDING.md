# Embedding and reverse proxies

Serve `/qa` through the normal DSH origin so it shares the established browser
connection, authentication and trust policy. The plugin's narrow navigation
route redirects GET/HEAD requests through DSH's canonical `/` document; the
client immediately restores `/qa` before mounting. Reverse proxies must pass
the configured QA path to DSH instead of replacing it with a separately hosted
page.

Iframe embedding is disabled or allowed by deployment headers, not by this
plugin. Configure an explicit CSP `frame-ancestors` allowlist at a trusted
reverse proxy and keep the DSH API same-origin. Do not enable wildcard CORS or
expose settings/session APIs without the deployment's authentication layer.
