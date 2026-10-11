import { describe, expect, it } from "vitest";
import {
  skillResourceGuidance,
  skillResourcePathHint,
} from "../../src/enforcement/skill-resource-paths.js";
import type { SkillResourceBase } from "@deepseek-ai/dsh-skill";

const loaded = new Map<string, SkillResourceBase>([
  ["demo-skill", { kind: "directory", path: "/opt/qa-skills/demo-skill" }],
]);
describe("skill resource path guidance", () => {
  it("gives the exact loaded resource path when a repository prefix was added", () => {
    expect(
      skillResourcePathHint(
        "/workspace/project/opt/qa-skills/demo-skill/references/workflow.md",
        loaded,
      ),
    ).toContain(
      'file_path="/opt/qa-skills/demo-skill/references/workflow.md" exactly',
    );
  });
  it.each([
    "/opt/qa-skills/demo-skill/references/workflow.md",
    "/workspace/project/opt/qa-skills/hidden-skill/references/workflow.md",
    "/workspace/project/opt/qa-skills/demo-skill-other/references/workflow.md",
    "/workspace/project/opt/qa-skills/demo-skill/../secret.txt",
    "references/workflow.md",
    null,
  ])(
    "does not remap correct, unrelated, unactivated or traversal paths: %s",
    (candidate) => {
      expect(skillResourcePathHint(candidate, loaded)).toBeUndefined();
    },
  );
  it("does not treat URL or opaque resources as filesystem paths", () => {
    const other = new Map<string, SkillResourceBase>([
      ["web", { kind: "url", url: "https://example.com/skills/demo" }],
      ["virtual", { kind: "opaque", description: "Provider resources" }],
    ]);
    expect(
      skillResourcePathHint("/workspace/project/skills/demo/ref.md", other),
    ).toBeUndefined();
    expect(skillResourceGuidance(other.get("web"))).toBe("");
  });
  it("preserves a real file even if its layout resembles a prefixed skill resource", () => {
    expect(
      skillResourcePathHint(
        "/workspace/project/opt/qa-skills/demo-skill/references/workflow.md",
        loaded,
        () => true,
      ),
    ).toBeUndefined();
  });
});
