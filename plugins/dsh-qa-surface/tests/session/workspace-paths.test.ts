import { describe, expect, it } from "vitest";
import { toWorkspaceRelativeText } from "../../src/client/workspace-paths.js";

const ROOT = "/workspace/work/.qa-users/6f2a1b3c-0000-4000-8000-aabbccddeeff";
const ARTIFACT = ".qa/artifacts/documents/doc_01ABC/report.docx";

describe("toWorkspaceRelativeText", () => {
  it("turns the workspace root into a name inside it", () => {
    const answer = `Файл создан: ${ROOT}/${ARTIFACT}`;
    const masked = toWorkspaceRelativeText(answer, ROOT);
    expect(masked).toBe(`Файл создан: ${ARTIFACT}`);
    expect(masked).not.toContain("/workspace/");
    expect(masked).not.toContain(".qa-users");
    expect(masked).not.toContain("6f2a1b3c");
  });

  it("masks the account partition of a root it was not given", () => {
    // A chat that has not been placed yet, or an answer quoting another chat's
    // file: the account identifier is the part that must not be printed, and it
    // sits inside the deployment's own parent directory.
    const masked = toWorkspaceRelativeText(
      `Расположение:\n/workspace/work/.qa-users/other-account/${ARTIFACT}`,
      undefined,
    );
    expect(masked).toBe(`Расположение:\n${ARTIFACT}`);
    expect(masked).not.toContain(".qa-users");
    expect(masked).not.toContain("/workspace/");
  });

  it("masks a backslash spelling of the same directory", () => {
    const root = "D:\\repos\\qa\\.qa-users\\account-1";
    expect(toWorkspaceRelativeText(`Готово: ${root}\\notes.md`, root)).toBe(
      "Готово: notes.md",
    );
  });

  it("leaves a path that says nothing about this workspace alone", () => {
    const answer = "Прочитай /etc/hosts и C:\\Windows\\win.ini";
    expect(toWorkspaceRelativeText(answer, ROOT)).toBe(answer);
    expect(toWorkspaceRelativeText("Таблица из трёх строк", ROOT)).toBe(
      "Таблица из трёх строк",
    );
  });

  it("masks every occurrence in one answer", () => {
    const line = `${ROOT}/${ARTIFACT}`;
    const masked = toWorkspaceRelativeText(`${line}\nСм. также ${line}`, ROOT);
    expect(masked).toBe(`${ARTIFACT}\nСм. также ${ARTIFACT}`);
  });
});
