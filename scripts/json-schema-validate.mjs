/**
 * Minimal JSON Schema validator for the catalog manifest.
 *
 * The catalog is validated against `docs/plugins.schema.json` without adding a
 * schema library to the toolchain. Only the keywords the catalog schema uses
 * are implemented, and every other validation keyword throws: a richer schema
 * must extend this module instead of silently losing its check.
 */

const ANNOTATION_KEYWORDS = new Set([
  "$comment",
  "$id",
  "$schema",
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

const SUPPORTED_KEYWORDS = new Set([
  "additionalProperties",
  "format",
  "items",
  "properties",
  "required",
  "type",
]);

const SUPPORTED_FORMATS = new Set(["uri"]);

const TYPE_CHECKS = {
  array: Array.isArray,
  boolean: (value) => typeof value === "boolean",
  integer: Number.isInteger,
  null: (value) => value === null,
  number: (value) => typeof value === "number" && Number.isFinite(value),
  object: (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  string: (value) => typeof value === "string",
};

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function unsupportedKeywords(schema) {
  return Object.keys(schema).filter(
    (keyword) =>
      !SUPPORTED_KEYWORDS.has(keyword) && !ANNOTATION_KEYWORDS.has(keyword),
  );
}

function typeErrors(value, type, path) {
  const types = Array.isArray(type) ? type : [type];
  for (const name of types) {
    if (!Object.hasOwn(TYPE_CHECKS, name)) {
      throw new Error(
        `unsupported schema type ${JSON.stringify(name)} at ${path}; ` +
          "extend scripts/json-schema-validate.mjs",
      );
    }
  }
  if (types.some((name) => TYPE_CHECKS[name](value))) return [];
  return [
    `${path}: expected ${types.join(" or ")}, received ${describeValue(value)}`,
  ];
}

function formatErrors(value, format, path) {
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new Error(
      `unsupported schema format ${JSON.stringify(format)} at ${path}; ` +
        "extend scripts/json-schema-validate.mjs",
    );
  }
  if (typeof value !== "string") return [];
  try {
    new URL(value);
  } catch {
    return [
      `${path}: expected an absolute URI, received ${JSON.stringify(value)}`,
    ];
  }
  return [];
}

/**
 * Validates `value` against `schema` and returns human-readable errors such as
 * `$.plugins[2].client: expected boolean, received string`. An empty array
 * means the value matches the schema. Unsupported schema constructs throw
 * instead of passing silently.
 */
export function validateAgainstSchema(value, schema, path = "$") {
  if (typeof schema === "boolean") {
    return schema ? [] : [`${path}: schema rejects every value`];
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${path}: schema must be an object or a boolean`);
  }

  const unsupported = unsupportedKeywords(schema);
  if (unsupported.length > 0) {
    throw new Error(
      `unsupported schema keyword(s) at ${path}: ${unsupported.join(", ")}; ` +
        "extend scripts/json-schema-validate.mjs",
    );
  }

  const errors = [];
  if ("type" in schema) {
    errors.push(...typeErrors(value, schema.type, path));
  }
  if ("format" in schema) {
    errors.push(...formatErrors(value, schema.format, path));
  }

  const isObject =
    typeof value === "object" && value !== null && !Array.isArray(value);
  if ("required" in schema && isObject) {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) {
        errors.push(`${path}.${key}: missing required property`);
      }
    }
  }
  if ("properties" in schema && isObject) {
    for (const [key, subschema] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, key)) continue;
      errors.push(
        ...validateAgainstSchema(value[key], subschema, `${path}.${key}`),
      );
    }
  }
  if ("additionalProperties" in schema && isObject) {
    const declared = new Set(Object.keys(schema.properties ?? {}));
    for (const [key, item] of Object.entries(value)) {
      if (declared.has(key)) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unexpected property`);
      } else if (typeof schema.additionalProperties === "object") {
        errors.push(
          ...validateAgainstSchema(
            item,
            schema.additionalProperties,
            `${path}.${key}`,
          ),
        );
      }
    }
  }
  if ("items" in schema && Array.isArray(value)) {
    if (Array.isArray(schema.items)) {
      throw new Error(
        `tuple schemas are not supported at ${path}; ` +
          "extend scripts/json-schema-validate.mjs",
      );
    }
    value.forEach((item, index) => {
      errors.push(
        ...validateAgainstSchema(item, schema.items, `${path}[${index}]`),
      );
    });
  }
  return errors;
}
