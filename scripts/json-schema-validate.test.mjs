import assert from "node:assert/strict";
import { test } from "node:test";

import { validateAgainstSchema } from "./json-schema-validate.mjs";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.invalid/schema.json",
  title: "catalog",
  description: "Fixture schema",
  type: "object",
  additionalProperties: false,
  required: ["repository", "plugins"],
  properties: {
    repository: { type: "string", format: "uri" },
    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "client"],
        properties: {
          name: { type: "string" },
          client: { type: "boolean" },
          keywords: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const valid = {
  repository: "https://example.invalid/repo",
  plugins: [{ name: "dsh-alpha", client: false, keywords: ["dsh"] }],
};

test("a matching instance has no errors", () => {
  assert.deepEqual(validateAgainstSchema(valid, schema), []);
});

test("type mismatches report the instance path", () => {
  assert.deepEqual(
    validateAgainstSchema(
      { ...valid, plugins: [{ name: "dsh-alpha", client: "yes" }] },
      schema,
    ),
    ["$.plugins[0].client: expected boolean, received string"],
  );
  assert.deepEqual(validateAgainstSchema({ ...valid, plugins: {} }, schema), [
    "$.plugins: expected array, received object",
  ]);
  assert.deepEqual(
    validateAgainstSchema(
      { ...valid, plugins: [{ name: "dsh-alpha", client: false, id: 1 }] },
      schema,
    ),
    ["$.plugins[0].id: unexpected property"],
  );
});

test("missing and unexpected properties are reported", () => {
  assert.deepEqual(
    validateAgainstSchema(
      { repository: valid.repository, plugins: [] },
      schema,
    ),
    [],
  );
  assert.deepEqual(validateAgainstSchema({ plugins: [] }, schema), [
    "$.repository: missing required property",
  ]);
  assert.deepEqual(validateAgainstSchema({ ...valid, topic: "dsh" }, schema), [
    "$.topic: unexpected property",
  ]);
});

test("nested item errors carry their index", () => {
  assert.deepEqual(
    validateAgainstSchema(
      {
        ...valid,
        plugins: [
          { name: "dsh-alpha", client: false },
          { name: "dsh-beta", client: false, keywords: ["dsh", 7] },
        ],
      },
      schema,
    ),
    ["$.plugins[1].keywords[1]: expected string, received number"],
  );
});

test("formats are enforced only on strings", () => {
  assert.deepEqual(
    validateAgainstSchema({ ...valid, repository: "not-a-uri" }, schema),
    ['$.repository: expected an absolute URI, received "not-a-uri"'],
  );
  assert.deepEqual(
    validateAgainstSchema({ ...valid, repository: 42 }, schema),
    ["$.repository: expected string, received number"],
  );
});

test("unknown properties validate against an object additionalProperties", () => {
  const open = {
    type: "object",
    additionalProperties: { type: "string" },
  };
  assert.deepEqual(validateAgainstSchema({ extra: "ok" }, open), []);
  assert.deepEqual(validateAgainstSchema({ extra: 1 }, open), [
    "$.extra: expected string, received number",
  ]);
});

test("unsupported validation keywords throw instead of passing silently", () => {
  for (const keyword of [
    { enum: ["a"] },
    { oneOf: [{ type: "string" }] },
    { anyOf: [{ type: "string" }] },
    { allOf: [{ type: "string" }] },
    { $ref: "#/$defs/a" },
    { $defs: { a: { type: "string" } } },
    { pattern: "^a$" },
    { minLength: 1 },
    { const: "a" },
  ]) {
    assert.throws(
      () => validateAgainstSchema("value", keyword),
      /unsupported schema keyword/u,
      `expected a throw for ${Object.keys(keyword).join()}`,
    );
  }
});

test("unsupported schema types, formats and tuples throw", () => {
  assert.throws(
    () => validateAgainstSchema("value", { type: "map" }),
    /unsupported schema type/u,
  );
  assert.throws(
    () => validateAgainstSchema("value", { type: "string", format: "date" }),
    /unsupported schema format/u,
  );
  assert.throws(
    () =>
      validateAgainstSchema(["value"], {
        type: "array",
        items: [{ type: "string" }],
      }),
    /tuple schemas are not supported/u,
  );
});

test("boolean schemas and type unions are supported", () => {
  assert.deepEqual(validateAgainstSchema("value", true), []);
  assert.deepEqual(validateAgainstSchema("value", false), [
    "$: schema rejects every value",
  ]);
  assert.deepEqual(
    validateAgainstSchema(null, { type: ["string", "null"] }),
    [],
  );
  assert.deepEqual(validateAgainstSchema(7, { type: ["string", "null"] }), [
    "$: expected string or null, received number",
  ]);
  assert.throws(() => validateAgainstSchema("value", null), TypeError);
});
