# NOTICE

`dsh-cas-results` is inspired by
[dsh-funnel](https://github.com/YuanyuanMa03/dsh-funnel)
by [YuanyuanMa03](https://github.com/YuanyuanMa03).

`dsh-funnel` pioneered the ingestion-time tool-result curation approach used as
the conceptual and implementation starting point for this plugin:

- intercept tool results before they enter model context;
- operate on the canonical successful result value;
- recursively inspect textual fields;
- replace oversized fields with a bounded model-facing representation;
- preserve access to the complete original content;
- keep error results untouched by default.

`dsh-cas-results` is an independent implementation. No source code was copied
from `dsh-funnel`; the storage layer (SHA-256 content addressing, filesystem
blob layout, atomic writes, compression, garbage collection) and the retrieval
tool suite are original to this repository. Because no source was copied, no
additional license text beyond the mandatory credit in `README.md` and this
notice is required; both are kept as a courtesy and for clarity.
