---
"@yadsh/dsh-qa-integrations": patch
---

A service credential that refuses a build log now says which rule refused it,
and the operator's capability switch says so beforehand.

`qa-integrations.teamcity.logsRead: true` really does grant the capability, and
a tester reading the operator's card has no way to learn that the managed
service credential still cannot read the log: the ceiling keeps the text a build
printed away from a shared account on purpose. The refusal arrived as «This
operation can return personal or otherwise sensitive data», which reads like a
fault in the stand's integration, so the operator's tick and the user's answer
never met. (Issue #285.)

The sensitive-read refusal now names the capability it refused
(`teamcity.logs.read`), the account that can read it, and that the switch and
the user's token are not at fault; the provider's own second lock words the same
distinction between a write, a personal read and a denied read, and answers with
the broker's code for every operation of every catalog. Every tool the ceiling
refuses as a reading says so in its description, the sentence being composed from
the operation's own classification — the model knows the condition before it
tries, and no provider can be left out of it. The operator card marks each
capability switch the managed credential does not reach — TeamCity logs and
artifacts, the GitLab CI job trace, Jira and Test IT attachments, the Bitrix24
reads of people and their text — with whether it escapes the credential whole or
in part, and stays quiet while the deployment hands out no managed credential;
the note comes off the toggle's own configuration path, so the card holds no copy
of a flag name to mistype. GitLab's CI is now the two switches the resolver
answers with (`ciMetadataRead` and `ciLogsRead`), each read in the resolver's own
order — the half, else the pre-split `ciRead`, else the default: one handle could
neither show a half switched off on its own nor set one without overriding the
alias it still displayed. Tests recompute the card's table from every provider catalog and count
the notes in the rendered card, so it cannot drift away from what the ceilings
actually enforce.
