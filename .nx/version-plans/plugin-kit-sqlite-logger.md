---
"@yadsh/dsh-plugin-kit": minor
---

A SQLite store can now say what it did to its file.

`SqliteDatabase` already owned the parts a store must not get wrong on its own:
WAL, one-time migrations, a schema version, a refusal to open a database a newer
build wrote. What it never reported was any of that happening. A schema step that
ran at start left no trace, so an operator reading a stand's logs afterwards
could not tell which database was opened, at which version, or whether this
start applied a migration at all — and the refusal, the one case where the store
knows it is about to leave a deployment without data, was visible only if the
caller chose to log the exception.

The constructor now takes an optional third argument: the plugin's own
`@yadsh/dsh-plugin-log` logger and a `label` that distinguishes two databases of
one plugin in one log. An open writes the file, the schema version reached and
the migration versions it applied; a refusal is recorded before it is raised.
The argument is optional exactly because eleven stores already call this
constructor with two arguments — they keep behaving as before, silently, until
their plugin passes a logger.
