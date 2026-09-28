import {
  buildJql,
  jqlLiteral,
  textClauses,
} from "../../src/providers/jira/jql.js";

describe("jql builder", () => {
  it("quotes and escapes every value it is given", () => {
    expect(jqlLiteral('a" OR project = SECRET', "query")).toBe(
      '"a\\" OR project = SECRET"',
    );
    expect(jqlLiteral("back\\slash", "query")).toBe('"back\\\\slash"');
    for (const bad of ["line\nbreak", "tab\there", ""]) {
      expect(() => jqlLiteral(bad, "query")).toThrow(/query is invalid/u);
    }
  });

  it("turns a text fragment into terms or a phrase, never into a clause", () => {
    expect(textClauses("payment timeout", "phrase")).toEqual([
      'text ~ "\\"payment timeout\\""',
    ]);
    expect(textClauses("payment timeout", undefined)).toEqual([
      'text ~ "payment"',
      'text ~ "timeout"',
    ]);
    expect(textClauses("timeout", undefined)).toEqual(['text ~ "timeout"']);
    expect(
      buildJql({ query: 'done" OR project = SECRET', match: "phrase" }),
    ).toBe('text ~ "\\"done\\" OR project = SECRET\\"" ORDER BY updated DESC');
    // Every word is its own clause, so an OR smuggled into a term stays inside
    // the string literal it was written in.
    expect(buildJql({ query: "x OR project = SECRET" })).toBe(
      'text ~ "x" AND text ~ "OR" AND text ~ "project" AND text ~ "=" AND text ~ "SECRET" ORDER BY updated DESC',
    );
  });

  it("builds the filter set the specification describes", () => {
    expect(
      buildJql({
        projectKeys: ["proj", "platform"],
        statuses: ["In Progress"],
        assignee: "me",
        reporter: "5b10ac8d82e05b22cc7d4ef5",
        labels: ["regression", "qa"],
        updatedAfter: "2026-09-01",
        createdAfter: "2026-09-01T10:30:00Z",
      }),
    ).toBe(
      'project in ("PROJ", "PLATFORM") AND status in ("In Progress") AND labels = "regression" AND labels = "qa" AND assignee = currentUser() AND reporter = "5b10ac8d82e05b22cc7d4ef5" AND created >= "2026-09-01 10:30" AND updated >= "2026-09-01" ORDER BY updated DESC',
    );
  });

  it("covers the filters a corporate Jira search is asked for", () => {
    expect(
      buildJql({
        issueTypes: ["Ошибка"],
        statusCategories: ["Done"],
        priorities: ["Критичный"],
        resolutions: ["Fixed"],
        components: ["Public API"],
        fixVersions: ["3.8"],
        affectedVersions: ["3.7"],
        statuses: ["Закрыт"],
      }),
    ).toBe(
      'issuetype in ("Ошибка") AND status in ("Закрыт") AND statusCategory = "Done" AND priority in ("Критичный") AND resolution in ("Fixed") AND component in ("Public API") AND fixVersion in ("3.8") AND affectedVersion in ("3.7") ORDER BY updated DESC',
    );
    // The category is a Jira constant, whatever case the caller sends.
    expect(buildJql({ statusCategories: ["done"] })).toContain(
      'statusCategory = "Done"',
    );
    expect(() => buildJql({ statusCategories: ["Closed"] })).toThrow(
      /statusCategories accepts To Do, In Progress, Done/u,
    );
  });

  it("expresses an empty version field and refuses a contradiction", () => {
    expect(buildJql({ fixVersionEmpty: true })).toBe(
      "fixVersion IS EMPTY ORDER BY updated DESC",
    );
    expect(buildJql({ fixVersionEmpty: false })).toBe(
      "fixVersion IS NOT EMPTY ORDER BY updated DESC",
    );
    expect(buildJql({ affectedVersionEmpty: true })).toBe(
      "affectedVersion IS EMPTY ORDER BY updated DESC",
    );
    expect(() =>
      buildJql({ fixVersions: ["3.8"], fixVersionEmpty: true }),
    ).toThrow(/contradict each other/u);
  });

  it("filters a custom field by the id the field catalog reported", () => {
    expect(
      buildJql({
        customFields: [
          { field: "customfield_10020", value: "Release 3.8" },
          { field: "customfield_10010", value: "high", match: "contains" },
          { field: "customfield_20000", empty: false },
        ],
      }),
    ).toBe(
      'customfield_10020 = "Release 3.8" AND customfield_10010 ~ "high" AND customfield_20000 IS NOT EMPTY ORDER BY updated DESC',
    );
    // A field name is refused: an instance can carry several fields with one
    // display name, and picking one of them would be a guess.
    expect(() => buildJql({ customFields: [{ field: "Product" }] })).toThrow(
      /customFields.field is invalid/u,
    );
    expect(
      buildJql({
        customFields: [
          { field: "customfield_10020", value: 'x" OR project = SECRET' },
        ],
      }),
    ).toBe(
      'customfield_10020 = "x\\" OR project = SECRET" ORDER BY updated DESC',
    );
    expect(() =>
      buildJql({
        customFields: Array.from({ length: 6 }, () => ({
          field: "customfield_1",
          value: "x",
        })),
      }),
    ).toThrow(/customFields is invalid/u);
  });

  it("takes Jira's relative date tokens as well as absolute dates", () => {
    expect(buildJql({ createdAfter: "-3w" })).toBe(
      "created >= -3w ORDER BY updated DESC",
    );
    expect(buildJql({ updatedBefore: "-4h" })).toBe(
      "updated <= -4h ORDER BY updated DESC",
    );
    expect(buildJql({ createdAfter: "-3w", createdBefore: "-1w" })).toBe(
      "created >= -3w AND created <= -1w ORDER BY updated DESC",
    );
    expect(buildJql({ updatedBefore: "2026-08-31" })).toBe(
      'updated <= "2026-08-31" ORDER BY updated DESC',
    );
    expect(() => buildJql({ updatedBefore: "yesterday" })).toThrow(
      /updatedBefore is invalid/u,
    );
  });

  it("refuses a search that would ask for the whole site", () => {
    expect(() => buildJql({})).toThrow(/at least one filter/u);
  });

  it("searches the history of a field with WAS and CHANGED", () => {
    expect(
      buildJql({
        history: [{ field: "status", op: "was", value: "In Progress" }],
      }),
    ).toBe('status WAS "In Progress" ORDER BY updated DESC');
    // The window the operator takes, and the single day it takes instead.
    expect(
      buildJql({
        history: [
          {
            field: "status",
            op: "was",
            value: "Done",
            after: "-2w",
            before: "-1w",
          },
        ],
      }),
    ).toBe('status WAS "Done" AFTER -2w BEFORE -1w ORDER BY updated DESC');
    expect(
      buildJql({
        history: [
          { field: "priority", op: "was", value: "High", on: "2026-09-01" },
        ],
      }),
    ).toBe('priority WAS "High" ON "2026-09-01" ORDER BY updated DESC');
    // A move needs no value to be a question: «статус менялся» is its own ask.
    expect(buildJql({ history: [{ field: "status", op: "changed" }] })).toBe(
      "status CHANGED ORDER BY updated DESC",
    );
    expect(
      buildJql({
        history: [
          {
            field: "resolution",
            op: "changed",
            from: "Отклонено",
            value: "Fixed",
            by: "me",
            after: "-3w",
          },
        ],
      }),
    ).toBe(
      'resolution CHANGED FROM "Отклонено" TO "Fixed" BY currentUser() AFTER -3w ORDER BY updated DESC',
    );
    // A person field keeps the identifier its product filters on, on both
    // sides of the move.
    expect(
      buildJql(
        {
          history: [
            {
              field: "assignee",
              op: "changed",
              value: "5b10ac8d82e05b22cc7d4ef5",
              by: "me",
            },
          ],
        },
        "cloud",
      ),
    ).toBe(
      'assignee CHANGED TO "5b10ac8d82e05b22cc7d4ef5" BY currentUser() ORDER BY updated DESC',
    );
    expect(
      buildJql(
        {
          history: [{ field: "assignee", op: "was", value: "smirnov" }],
        },
        "server",
      ),
    ).toBe('assignee WAS "smirnov" ORDER BY updated DESC');
    // The field is matched whatever case it is sent in, the way the status
    // category is, and is spelled back the way Jira names it.
    expect(
      buildJql({ history: [{ field: "fixversion", op: "was", value: "3.8" }] }),
    ).toContain('fixVersion WAS "3.8"');
    // History clauses join the rest of the search, ANDed like every filter.
    expect(
      buildJql({
        projectKeys: ["PROJ"],
        history: [
          { field: "status", op: "was", value: "In Progress" },
          { field: "priority", op: "changed", after: "-2d" },
        ],
      }),
    ).toBe(
      'project in ("PROJ") AND status WAS "In Progress" AND priority CHANGED AFTER -2d ORDER BY updated DESC',
    );
  });

  it("keeps a history value a value, never a clause", () => {
    expect(
      buildJql({
        history: [
          { field: "status", op: "was", value: 'x" OR project = SECRET' },
        ],
      }),
    ).toBe('status WAS "x\\" OR project = SECRET" ORDER BY updated DESC');
    expect(
      buildJql({
        history: [{ field: "status", op: "was", value: "back\\slash" }],
      }),
    ).toBe('status WAS "back\\\\slash" ORDER BY updated DESC');
  });

  it("refuses a history filter it cannot read", () => {
    for (const unusable of [
      [],
      "status WAS Done",
      ["status"],
      Array.from({ length: 4 }, () => ({
        field: "status",
        op: "changed",
      })),
    ]) {
      expect(() => buildJql({ history: unusable })).toThrow(
        /history is invalid/u,
      );
    }
    // A field with no searchable history, and a field that belongs to
    // customFields rather than to this filter.
    for (const field of ["description", "customfield_1002", "labels"]) {
      expect(() =>
        buildJql({ history: [{ field, op: "was", value: "x" }] }),
      ).toThrow(/history\.field accepts status/u);
    }
    expect(() =>
      buildJql({ history: [{ field: "status", op: "held", value: "x" }] }),
    ).toThrow(/history\.op accepts/u);
    expect(() =>
      buildJql({ history: [{ field: "status", op: "was" }] }),
    ).toThrow(/needs the value the field held/u);
    // A keyword that cannot belong to the operator is refused, not dropped.
    expect(() =>
      buildJql({
        history: [{ field: "status", op: "was", value: "Done", from: "Open" }],
      }),
    ).toThrow(/only history\.op changed answers/u);
    expect(() =>
      buildJql({
        history: [
          {
            field: "status",
            op: "was",
            value: "Done",
            on: "2026-09-01",
            after: "-2w",
          },
        ],
      }),
    ).toThrow(/contradict each other/u);
    expect(() =>
      buildJql({
        history: [
          { field: "status", op: "was", value: "Done", after: "yesterday" },
        ],
      }),
    ).toThrow(/history\.after is invalid/u);
    // A person here is the identifier the change log shows: this filter reads
    // no directory, so a name is refused instead of quietly matching nobody.
    expect(() =>
      buildJql({
        history: [{ field: "assignee", op: "changed", value: "Иван Иванов" }],
      }),
    ).toThrow(/must be "me" or the accountId/u);
    expect(() =>
      buildJql({
        history: [{ field: "status", op: "changed", by: "Иван Иванов" }],
      }),
    ).toThrow(/history\.by must be/u);
    expect(() =>
      buildJql({
        history: [{ field: "status", op: "was", value: "line\nbreak" }],
      }),
    ).toThrow(/history\.value is invalid/u);
  });

  it("refuses a name where Jira needs an account id", () => {
    expect(() => buildJql({ assignee: "Иван Иванов" })).toThrow(
      /must be "me" or the accountId/u,
    );
    expect(() => buildJql({ projectKeys: ["not a key"] })).toThrow(
      /projectKeys is invalid/u,
    );
    expect(() => buildJql({ updatedAfter: "yesterday" })).toThrow(
      /updatedAfter is invalid/u,
    );
    expect(() => buildJql({ labels: ["x".repeat(101)] })).toThrow(
      /labels is invalid/u,
    );
  });
});
