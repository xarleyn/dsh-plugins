const evidence = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: { type: "string", required: true },
    quote: { type: "string", required: true },
    productVersion: { type: "string" },
  },
} as const;
const strings = {
  type: "array",
  items: { type: "string" },
  required: true,
} as const;

/** Machine-readable input shape; prose alone does not establish array/object distinctions. */
export const WORKFLOW_UPDATE_PROPERTIES = {
  facts: {
    type: "array",
    required: true,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: { type: "string", required: true },
        value: { type: "string", required: true },
        evidence: { ...evidence, required: true },
      },
    },
  },
  requirements: {
    type: "array",
    required: true,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", required: true },
        text: { type: "string", required: true },
        coverage: {
          type: "string",
          required: true,
          enum: ["full", "partial", "none", "unclear"],
        },
        modules: strings,
        evidence: { type: "array", required: true, items: evidence },
        limitationDecision: evidence,
      },
    },
  },
  excludedModules: strings,
  scopeDepth: { type: "string", required: true, enum: ["minimal", "extended"] },
  unresolved: strings,
  commercial: {
    type: "object",
    additionalProperties: false,
    properties: {
      currency: { type: "string", required: true },
      lines: {
        type: "array",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: { type: "string", required: true },
            title: { type: "string", required: true },
            quantity: { type: "string", required: true },
            unitPrice: { type: "string", required: true },
            quantitySource: { type: "string", required: true },
            priceSource: { type: "string", required: true },
          },
        },
      },
    },
  },
} as const;
