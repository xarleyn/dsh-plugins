/** Native structured capture for a review that must produce a usable verdict. */
export const EXPERT_REVIEW_OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string" as const,
      description:
        "Verification summary. Include successful checks and confirmed user decisions here, not in objection arrays.",
    },
    findings: {
      type: "array" as const,
      description:
        "Only objections requiring corrections or material verification gaps. Empty when all material claims are verified. Never list successful checks here.",
      items: {
        type: "object" as const,
        properties: {
          claim: { type: "string" as const },
          evidence: {
            type: "array" as const,
            items: { type: "string" as const },
          },
          confidence: {
            type: "string" as const,
            enum: ["high", "medium", "low"],
          },
        },
        required: ["claim", "evidence", "confidence"],
        additionalProperties: false,
      },
    },
    conflicts: {
      type: "array" as const,
      description: "Only unresolved contradictions. Empty when none remain.",
      items: { type: "string" as const },
    },
    assumptions: {
      type: "array" as const,
      description:
        "Only unsupported assumptions that block verification. Confirmed facts, accepted limitations and sourced definitions belong in summary. Empty when none remain.",
      items: { type: "string" as const },
    },
    followUps: {
      type: "array" as const,
      description:
        "Only blocking corrections or required evidence still missing. Never request excluded scope, extra features or optional improvements. Empty when none remain.",
      items: { type: "string" as const },
    },
  },
  required: ["summary", "findings", "conflicts", "assumptions", "followUps"],
  additionalProperties: false,
};
