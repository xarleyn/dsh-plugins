# v1 specification

## Product contract

1. A user can keep at least 20 drafts in one Workspace.
2. Every draft is independently editable.
3. Creating a draft never sends a model request.
4. Drafts appear as visually muted Session-like rows.
5. Opening a draft restores exactly its unsent text.
6. Switching between drafts never mixes their text.
7. A page reload does not lose drafts.
8. A DSH restart does not lose drafts.
9. If a backing blank Session disappears, the plugin creates another and rebinds it.
10. The first accepted Send converts the draft into a normal DSH Session.
11. A rejected Send leaves the draft intact.
12. Normal DSH Sessions are unaffected.
13. Removing the plugin does not corrupt or modify ordinary Session history.
14. Draft text never enters model context before Send.
15. Multiple browsers connected to one Host see the same Host-backed drafts.

## v1 data model

Each record contains a format version, draft id, nullable backing Session id, Workspace identity, unsent text, optional explicit title, timestamps, ordering, state, and optimistic `revision`.

The durable file is versioned independently from each record. Unsupported or malformed durable data fails loudly; the plugin never silently resets a corrupt file.

## Lifecycle

```text
create DraftRecord
      ↓
create/open blank Session
      ↓
edit + debounced optimistic autosave
      ↓
first prompt accepted
      ↓
Session.blank: true → false
      ↓
delete DraftRecord
```

If the prompt is rejected, `blank` remains true and the record remains. If the backing Session is missing, the client creates a replacement and calls `rebind`.

## Scope

### Included

- Text drafts and textual `@file` references
- Model, preset, and permission state owned by the backing Session
- At least 20 drafts per Workspace
- Reordering
- Host persistence
- Multiple browser synchronization
- Reload/restart recovery

### Deferred

- Images and binary attachments
- Archive, fork, and export before materialization
- Cross-Host synchronization
- Conflict-free collaborative text editing

## Required end-to-end scenarios

### Isolation and reload

```text
create A → type AAA
create B → type BBB
open A → AAA
open B → BBB
reload
open A → AAA
open B → BBB
```

### Host restart recovery

```text
draft A → restart Host → backing Session missing
→ create replacement blank Session → rebind → text preserved
```

### Conversion

```text
draft → Send → prompt accepted → blank becomes false
→ draft row disappears → normal Session row appears
```

## Implementation status

| Area                              | Status      |
| --------------------------------- | ----------- |
| Durable schema and JSON store     | Implemented |
| CRUD, ordering, limits, revisions | Implemented |
| Strict Client Remote contract     | Implemented |
| Backing Session lifecycle         | Implemented |
| Composer restore/autosave         | Implemented |
| Draft-aware workspace sidebar     | Partial     |
| Browser/Host E2E coverage         | Planned     |
