import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  QaSourcePreviewError,
  readSourceFilePreview,
  type QaSourceFilePreviewRequest,
} from "../src/provenance/file-preview.js";

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function scratch(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

type Request = Partial<QaSourceFilePreviewRequest> &
  Pick<QaSourceFilePreviewRequest, "cwd" | "sourcePath">;

/** One preview request with the mechanics defaults filled in. */
function request(fields: Request): QaSourceFilePreviewRequest {
  return {
    isEvidence: () => true,
    maxBytes: 10_000,
    maxMarkdownRenderBytes: 10_000,
    ...fields,
  };
}

/** The refusal reason of one failed preview, or null when it succeeded. */
async function refusalReason(fields: Request): Promise<string | null> {
  try {
    await readSourceFilePreview(request(fields));
    return null;
  } catch (error) {
    if (!(error instanceof QaSourcePreviewError)) throw error;
    return error.reason;
  }
}

describe("source file preview", () => {
  it("recognizes Markdown and enforces byte/render limits", async () => {
    const cwd = await scratch("qa-source-preview-");
    await writeFile(join(cwd, "guide.md"), "# Guide\n0123456789", "utf8");
    const preview = await readSourceFilePreview(
      request({
        cwd,
        sourcePath: "guide.md",
        maxBytes: 10,
        maxMarkdownRenderBytes: 5,
      }),
    );
    expect(preview).toMatchObject({
      path: "guide.md",
      markdown: true,
      renderableMarkdown: false,
      truncated: true,
      content: "# Guide\n01",
    });
  });

  it("matches an absolute request against the recorded relative path", async () => {
    const cwd = await scratch("qa-source-spelling-");
    await mkdir(join(cwd, "docs"));
    const absolute = join(cwd, "docs", "guide.md");
    await writeFile(absolute, "# Guide", "utf8");
    const matched: string[] = [];
    const preview = await readSourceFilePreview(
      request({
        cwd,
        sourcePath: absolute,
        isEvidence: (path) => {
          matched.push(path);
          return path === "docs/guide.md";
        },
      }),
    );
    expect(matched).toEqual(["docs/guide.md"]);
    expect(preview.path).toBe("docs/guide.md");
  });

  it("refuses a path the bundle does not carry as evidence", async () => {
    const cwd = await scratch("qa-source-not-evidence-");
    await writeFile(join(cwd, "guide.md"), "# Guide", "utf8");
    expect(
      await refusalReason({
        cwd,
        sourcePath: "guide.md",
        isEvidence: () => false,
      }),
    ).toBe("not-evidence");
  });

  it("rejects traversal outside the configured root", async () => {
    const parent = await scratch("qa-source-boundary-");
    const cwd = join(parent, "root");
    await mkdir(cwd);
    await writeFile(join(parent, "secret.txt"), "secret", "utf8");
    expect(await refusalReason({ cwd, sourcePath: "../secret.txt" })).toBe(
      "outside-roots",
    );
  });

  it("reads a shared read-only root the guard already opens", async () => {
    const workspace = await scratch("qa-shared-root-");
    const cwd = join(workspace, "work", ".qa-users", "account");
    const docs = join(workspace, "docs");
    await mkdir(cwd, { recursive: true });
    await mkdir(join(docs, "Admin_guide"), { recursive: true });
    const source = join(docs, "Admin_guide", "web_client.md");
    await writeFile(source, "# Web client\n", "utf8");
    const preview = await readSourceFilePreview(
      request({ cwd, sharedReadOnlyRoots: [docs], sourcePath: source }),
    );
    expect(preview).toMatchObject({ markdown: true });
    // The answer echoes the canonical path the panel can compare with a bundle.
    expect(preview.path).toBe(
      source
        .replaceAll("\\", "/")
        .replace(/^[A-Z]:/u, (drive) => drive.toLowerCase()),
    );
  });

  it("reads the attachment store without opening anything else beside it", async () => {
    const workspace = await scratch("qa-attachment-root-");
    const cwd = join(workspace, "work");
    const store = join(workspace, "attachments");
    const neighbour = join(workspace, "elsewhere");
    await mkdir(cwd, { recursive: true });
    await mkdir(store, { recursive: true });
    await mkdir(neighbour, { recursive: true });
    const upload = join(store, "upload-1.png");
    await writeFile(upload, "png", "utf8");
    await writeFile(join(neighbour, "other.txt"), "other", "utf8");
    expect(
      await refusalReason({
        cwd,
        attachmentRoot: store,
        sourcePath: join(neighbour, "other.txt"),
      }),
    ).toBe("outside-roots");
    const preview = await readSourceFilePreview(
      request({ cwd, attachmentRoot: store, sourcePath: upload }),
    );
    expect(preview.content).toBe("png");
  });

  it("separates a moved file from a directory outside the roots", async () => {
    const workspace = await scratch("qa-missing-source-");
    const cwd = join(workspace, "work");
    const docs = join(workspace, "docs");
    await mkdir(cwd, { recursive: true });
    await mkdir(docs, { recursive: true });
    expect(
      await refusalReason({
        cwd,
        sharedReadOnlyRoots: [docs],
        sourcePath: join(docs, "gone.md"),
      }),
    ).toBe("unavailable");
  });

  it("ignores a declared root that is not mounted", async () => {
    const workspace = await scratch("qa-unmounted-root-");
    const cwd = join(workspace, "work");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "note.md"), "# Note", "utf8");
    const preview = await readSourceFilePreview(
      request({
        cwd,
        sharedReadOnlyRoots: [join(workspace, "not-mounted")],
        sourcePath: join(cwd, "note.md"),
      }),
    );
    expect(preview.content).toBe("# Note");
  });

  it("refuses a root itself and a directory that is not a file", async () => {
    const workspace = await scratch("qa-directory-source-");
    const cwd = join(workspace, "work");
    await mkdir(join(cwd, "notes"), { recursive: true });
    expect(await refusalReason({ cwd, sourcePath: cwd })).toBe("outside-roots");
    expect(await refusalReason({ cwd, sourcePath: "notes" })).toBe(
      "unavailable",
    );
  });
});
