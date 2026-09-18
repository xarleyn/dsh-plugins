---
"@yadsh/dsh-web-fetch-authenticated": minor
---

Read a Jira issue's description and attachments, and give images a download path that does not stop at the text seam.

The Jira REST request never asked for `description`, so the adapter's own description renderer had nothing to render: an issue reached the model as a title, a status row and a comment list, and the body it was opened to read stayed invisible. The same request now asks for `attachment` and the card renders a `## Attachments` list — name, size, media type and the download URL — the way the Confluence adapter already does, so a file a sentence refers to is reachable instead of being a name with nothing behind it.

Images had no path at all: `web_fetch` carries the `html | text` body union of `@deepseek-ai/dsh-web` and no provider can put bytes in it, so an image attachment failed as `unsupported content type "image/png"`, while the browser refused the same URL under its network policy. The plugin now registers a second tool, `web_fetch_image`, beside the provider: it travels the same rule match, network policy, credentials and redirect validation, reads a bounded body, decides the format from the file signature (`image/png`, `image/jpeg`, `image/webp`, `image/gif` — a Jira attachment is served as `application/octet-stream`), commits the bytes through `ctx.attachments.saveImage` and hands the model the image block itself. A body that is not a raster image fails with `AUTH_FETCH_NOT_AN_IMAGE` naming the HTTP status and content type that arrived; an oversized one fails with `AUTH_FETCH_IMAGE_TOO_LARGE`. The tool exists only where a durable attachment store is mounted, and a route whose model declares no image input is refused before the download starts.
