---
"@yadsh/dsh-qa-integrations": patch
---

The tests this package had not yet filed by domain now sit in the folder of the
module they drive, following the shape `dsh-qa-surface` got in #224.

Sixty files still lay directly under `tests/` on this slice — fifty-five test
files and five fixtures. The provider folders, `kernel/` and the seven
provider suites had already been sorted out by #295 and #319; what was left was
the part of the package that is not a provider: the client cards, the service
credential broker and its policy, rate limit and configuration, the shared
provider machinery, the storage layer, the model-visible tool surface, the
plugin entry and the probe script. One column of sixty names carried that
information in a prefix, and the prefix had begun to lie: `catalog.test.ts` is
mostly a Bitrix24 suite, `provider-http.test.ts` reads the kernel's read policy,
and `broker-isolation.test.ts` belongs with the broker suites it is named after
nothing of.

The domain folders now say it instead — `client`, `service-credentials`,
`shared`, `kernel`, `helpers`, `storage`, `tools`, `utils`, `host`, `scripts`,
each mirroring a boundary in `src/`, and the four `*-catalog`,
`*-service-boundary`, `*-service-credentials` and `*-service.helpers` files
joined the provider folder whose name they repeated. Nothing was re-asserted:
no test body, fixture or expectation was rewritten, only paths and the relative
specifiers that resolve them, plus the depth of the two paths these suites build
at run time (`REPOSITORY_ROOT` of the probe suite and `lib/client.js` of the
bundle suite). The suite runs the same before and after — one hundred and
nineteen files, nine hundred and ten cases, two hundred and eighty-two describe
blocks — and a json snapshot compared by full case title reports no difference,
which is the measure this card was opened with: no file is left at the top level
of `tests/`.

Three source comments and the paths in `README.md` and `docs/specs/` that point
at a test file were repointed at its new home; no identifier, no `data-testid`
and no public API changed, so the curated changelog is untouched and this change
is not user-visible.
