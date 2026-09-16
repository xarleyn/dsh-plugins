---
"@yadsh/dsh-qa-integrations": minor
---

Mount the integrations as a card of the host's "Plugin configuration" tab. A
connection belongs to a QA account, and until now the only surface that could
carry it was the `Интеграции` page inside the QA settings dialog: the card of
the plugins list is dispatched by a settings namespace, and this plugin served
none. The deployment now installs a mount-only `qa-integrations` section (the
provider switches, the address policy and the vault path stay composition-time
decisions, so the section carries nothing an operator could edit), and the
browser half registers the card under that namespace through the shared
`dsh-plugin-card` shell.

The card renders one provider card per mounted provider, exactly as the QA page
does — both mounts share the component — and reads the account through the new
`qaUserSession` client service of `@yadsh/dsh-qa-surface`. Without a signed-in
QA account it says so instead of showing connect forms whose every call would be
refused, and it stays closed (and therefore reads nothing) until it is opened.

The credential forms gained the fix they needed to be usable at all: the primary
button asked for `--dsw-alias-label-on-brand`, a token the DSH theme does not
define, so the label inherited the card's own colour and the button rendered as
a grey pill with no text. The status badge and the danger action were painted
with two more non-existent tokens (`--dsw-alias-success-primary`,
`--dsw-alias-error-primary`) that cost the status its green and the error box its
border. All three now use the tokens the first-party cards use, and the package
gate rejects the dead names.
