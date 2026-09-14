---
"@yadsh/dsh-qa-surface": minor
---

Give every account skills of its own, and one settings dialog to manage them.

A QA user could shape how the assistant answers only through the profile: the
preset, the tools and the model all belong to the deployment. A skill is the
first artifact a visitor authors themselves, so it is stored as what the
harness already defines — an ordinary `SKILL.md` directory below the account's
own workspace, `<workspace>/.qa-users/<uuid>/.dsh/skills/<name>/SKILL.md` —
rather than as a format of this plugin's invention. The file stays editable by
hand, copyable as a directory, and readable by DSH itself; the frontmatter
fields the editor does not own survive a save verbatim.

The catalog reaches the model through a `qa-user-skills` provider the plugin
registers with `ctx.skills`, not through the shipped filesystem provider: that
one resolves its project root through the nearest `.git`, which for an account
directory inside a larger checkout climbs above the account and mixes users
together. Discovery reads exactly one place and only for a cwd that matches the
`.qa-users/<uuid>` layout, so no account sees another's skills and an arbitrary
cwd names nothing. Saving invalidates the registry, so a new skill is usable
without a restart, and a lazy bounded watcher covers files edited outside the
editor.

`allowed-tools` is stored as declared and never grants anything: the effective
set is the intersection of what the QA scope allows with what the skill
declares, an unavailable tool is reported and kept in the file so an imported
skill stays repairable, and the editor says so in as many words. Runtime
restriction of an active skill's turn is deliberately not implemented — the
harness has no reliable active-skill seam for a plugin, and promising
enforcement the code does not perform is worse than not offering it.

The separate profile modal is gone. The account button now opens one
`Настройки` dialog with a section list — `Профиль`, `Общие`, `Навыки` — and
the profile page inside it is the old form unchanged: same fields, same
storage, same limits, same instruction that it widens no tools. The skills
section is a catalog with search plus an editor carrying the description, the
"when to use" hint, the invocation flags, the Markdown body, a tool picker over
the deployment's registry and a preview produced by the same serializer a save
uses. Saving is atomic and carries the revision the editor read, so an edit
made in another tab or by hand is refused instead of overwritten, and a delete
moves the whole directory to `.dsh/skills-trash/`.

Deployments that cannot host the feature — accounts off, or
`accounts.perUserWorkspace` off, since there is no shared fallback to store a
personal skill in — resolve `accounts.skills.enabled` to false and simply see
no Навыки section.
