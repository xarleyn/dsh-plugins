---
"@yadsh/dsh-qa-integrations": patch
---

The sections of the operator card are now addressable by a stable hook.

Every section and group the operator card renders from `client/operator-sections`
carries a `data-testid`: one zone per provider (`qa-integrations-jira`,
`qa-integrations-gitlab`, …), the blocks inside it by what they hold
(`-provider`, `-connection`, `-capabilities`, `-limits`), and the same shape for
the `general`, `service-access` and per-provider credential-help sections. The
zone is derived from the provider key the section already declares, so a new
provider inherits its hooks instead of naming them again, and no two ids in the
package collide.

The card's own tests now reach a section, a group and a profile row through those
ids rather than through the Russian caption or the BEM class that used to identify
it, so rewording a heading or restyling a block no longer blinds a test that was
asserting something else. What a test asserts about a caption — the group titles
of a provider, the collapsed state line — is still asserted by role and accessible
name. No markup and no style changed: an attribute was added.
