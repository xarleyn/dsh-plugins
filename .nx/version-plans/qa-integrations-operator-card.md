---
"@yadsh/dsh-qa-integrations": minor
---

An operator card for the deployment configuration, live in "Plugins → Plugin
configuration".

Until now every deployment knob — provider switches, instance and site lists,
the TeamCity address with its network policy, managed service credentials —
lived only in the profile's composition row, and the Host settings page showed
a card that asked for a QA sign-in, because connections belong to accounts. An
operator who just wanted to flip a capability had to edit yaml and restart.

The plugin now installs its configuration as a real settings namespace and
mounts an operator card on it, beside the user surfaces. The card covers the
whole resolved configuration: the general knobs (enabled, timeouts, response
and audit budgets, the Bitrix24 portal suffixes), every provider's capability
switches and limits, the instance and site lists with id/label/address rows,
the TeamCity server address and its address policy, managed service credential
profiles with their resource boundaries and deny policy, and the per-provider
credential-help overrides. Every field shows whether the user layer overrides
the composition row, one button clears the layer back to yaml, and a refused
value is reported on the card instead of stored.

Edits apply to the running service as they are committed: the broker is
re-pointed at the freshly resolved provider set, and the tool mount follows the
enabled flag and the one write capability. The connection store and its master
key are the deliberate exception — connections and wrapped secrets belong to
the boot path, so re-pointing them warns and waits for a Host restart instead
of reopening the store under running connections. A deployment without a
settings provider behaves exactly as before, booting on the composition row.
