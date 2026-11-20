import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { QaSurface } from "../../src/index.js";
import { sharingFixture } from "./chat-sharing.helpers.js";

// Delay only the selected file in this test. The original open and read still run.
const beforeOpen = vi.hoisted(() =>
  vi.fn<(path: unknown) => Promise<void> | void>(),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      await beforeOpen(args[0]);
      return fs.open(...args);
    },
  };
});

const sessionId = "chat-a";
const note = "![diagram](diagram.png)";
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pdf = Buffer.from("%PDF-1.4");
const document = {
  kind: "pdf",
  name: "guide.docx",
  bytes: pdf.length,
  mime: "application/pdf",
  base64: pdf.toString("base64"),
};
const documentSource = {
  path: "guide.docx",
  content: "",
  size: pdf.length,
  truncated: false,
  markdown: false,
  renderableMarkdown: false,
  document,
};

function signal() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture() {
  const sharing = sharingFixture();
  const root = dirname(sharing.dbPath);
  onTestFinished(async () => {
    beforeOpen.mockReset();
    sharing.store.storage.close();
    sharing.accounts.close();
    await rm(root, { recursive: true, force: true });
  });
  const workspace = { cwd: join(await realpath(root), "workspace") };
  const filePreview = {
    enabled: true,
    maxBytes: 1024,
    maxMarkdownRenderBytes: 1024,
  };
  await mkdir(workspace.cwd);
  await Promise.all([
    writeFile(join(workspace.cwd, "note.md"), note),
    writeFile(join(workspace.cwd, "diagram.png"), image),
    writeFile(join(workspace.cwd, "guide.docx"), "PK"),
    writeFile(join(workspace.cwd, "preview.pdf"), pdf),
  ]);
  const session = { header: workspace, snapshotEvents: () => [] };
  const secureOwner = vi.fn(async () => ({ enabled: true, sessionId }));
  const published = new Set(
    ["note.md", "guide.docx"].map((p) => join(workspace.cwd, p)),
  );
  let beforeConvert: (() => Promise<void>) | undefined;
  const convert = vi.fn(async () => {
    await beforeConvert?.();
    return {
      files: [
        {
          format: "pdf",
          status: "created",
          path: join(workspace.cwd, "preview.pdf"),
        },
      ],
    };
  });
  let documents: { convert: typeof convert } | undefined;
  const debug = vi.fn();
  const surface = Object.create(QaSurface.prototype) as QaSurface;
  Object.assign(surface, {
    chatSharingStore: sharing.store,
    accountRemotes: { resolve: () => sharing.accounts },
    getConfig: () => ({
      accounts: { enabled: true },
      lockdown: { sharedReadOnlyRoots: [] },
      sources: { filePreview },
    }),
    admission: {
      secureSessionForUser: secureOwner,
      attachmentRoot: () => undefined,
    },
    ctx: {
      sessions: { get: () => session },
      agents: { get: () => ({ session }) },
      get: (key: string) => (key === "documents" ? documents : undefined),
    },
    provenance: {
      sourceAllowed: (id: string, path: string) =>
        id === sessionId && published.has(resolve(workspace.cwd, path)),
    },
    logger: { debug },
  });
  return {
    ...sharing,
    surface,
    debug,
    secureOwner,
    workspace,
    filePreview,
    published,
    convert,
    registerDocuments: (pause?: () => Promise<void>) => {
      beforeConvert = pause;
      documents = { convert };
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const source = {
  path: "note.md",
  size: note.length,
  content: note,
  truncated: false,
  markdown: true,
  renderableMarkdown: true,
};
const reads = [
  {
    method: "readSourceFile",
    refusalEvent: "source.preview-refused",
    file: "note.md",
    run: (f: Fixture) =>
      f.surface.readSourceFile(f.reader.token, sessionId, "note.md"),
    expected: source,
  },
  {
    method: "readSourceImage",
    refusalEvent: null,
    file: "diagram.png",
    run: (f: Fixture) =>
      f.surface.readSourceImage(
        f.reader.token,
        sessionId,
        "note.md",
        "diagram.png",
      ),
    expected: `data:image/png;base64,${image.toString("base64")}`,
  },
  {
    method: "readWorkspaceFile",
    refusalEvent: "workspace.read-refused",
    file: "note.md",
    run: (f: Fixture) =>
      f.surface.readWorkspaceFile(f.reader.token, sessionId, "note.md"),
    expected: {
      path: "note.md",
      size: note.length,
      text: note,
      markdown: true,
      renderableMarkdown: true,
      truncated: false,
      mime: "text/markdown",
    },
  },
  {
    method: "readWorkspaceFileChunk",
    refusalEvent: "workspace.download-refused",
    file: "note.md",
    run: (f: Fixture) =>
      f.surface.readWorkspaceFileChunk(
        f.reader.token,
        sessionId,
        "note.md",
        0,
        null,
      ),
    expected: {
      path: "note.md",
      size: note.length,
      offset: 0,
      done: true,
      version: expect.any(String),
      base64: Buffer.from(note).toString("base64"),
    },
  },
  {
    method: "readSourceFile with document fallback",
    refusalEvent: "source.preview-refused",
    run: (f: Fixture) =>
      f.surface.readSourceFile(f.reader.token, sessionId, "guide.docx"),
    expected: documentSource,
  },
  {
    method: "previewWorkspaceDocument",
    refusalEvent: "workspace.preview-refused",
    run: (f: Fixture) =>
      f.surface.previewWorkspaceDocument(
        f.reader.token,
        sessionId,
        "guide.docx",
      ),
    expected: document,
  },
];

describe.each(reads)("$method on a shared chat", (read) => {
  const { file, run, expected, refusalEvent } = read;
  it.each(["allowed", "grant revoked", "account disabled"] as const)(
    "finishes a suspended read with access %s",
    async (access) => {
      const f = await fixture();
      const entered = signal();
      const resume = signal();
      const pause = () => {
        entered.release();
        return resume.promise;
      };
      if (file !== undefined) {
        const target = join(f.workspace.cwd, file);
        beforeOpen.mockImplementation((path) =>
          path === target ? pause() : undefined,
        );
      } else {
        f.registerDocuments(pause);
      }
      const result = run(f);
      try {
        await Promise.race([
          entered.promise,
          result.then(() => {
            throw new Error("Read finished before the expected I/O");
          }),
        ]);
        expect(f.secureOwner).toHaveBeenCalledWith(f.owner.user.id, sessionId);
        if (access === "grant revoked")
          f.store.set(f.owner.token, sessionId, f.reader.user.email, null);
        if (access === "account disabled")
          f.accounts.setAccessDisabled(f.reader.user.id, true);
      } finally {
        resume.release();
      }
      if (access === "allowed") await expect(result).resolves.toEqual(expected);
      else {
        await expect(result).rejects.toThrow(
          /^QA source preview refused the request \(reason: unavailable\)$/u,
        );
        if (refusalEvent === null) expect(f.debug).not.toHaveBeenCalled();
        else
          expect(f.debug).toHaveBeenCalledWith(refusalEvent, {
            sessionId,
            reason: "unavailable",
          });
      }
    },
  );
});

it("rejects unpublished paths and disabled previews before file I/O or read diagnostics", async () => {
  const f = await fixture();
  const read = (name: string) =>
    f.surface.readWorkspaceFile(f.reader.token, sessionId, name);
  await expect(read("preview.pdf")).rejects.toThrow(
    "This file has not been shared in the chat.",
  );
  f.filePreview.enabled = false;
  await expect(read("note.md")).rejects.toThrow("(reason: unavailable)");
  expect(beforeOpen).not.toHaveBeenCalled();
  expect(f.debug).not.toHaveBeenCalled();
});

it("uses a documents provider registered after an unsupported source preview", async () => {
  const f = await fixture();
  const read = () =>
    f.surface.readSourceFile(f.reader.token, sessionId, "guide.docx");
  await expect(read()).rejects.toThrow("(reason: unsupported)");
  f.registerDocuments();
  await expect(read()).resolves.toEqual(documentSource);
  expect(f.convert).toHaveBeenCalledWith(
    { file: join(f.workspace.cwd, "guide.docx"), targetFormat: "pdf" },
    { sessionId, workspaceRoot: f.workspace.cwd },
  );
});

it("samples the current chat cwd and preview limits on each read", async () => {
  const f = await fixture();
  const read = () =>
    f.surface.readSourceFile(f.reader.token, sessionId, "note.md");
  await expect(read()).resolves.toEqual(source);
  f.workspace.cwd = join(f.workspace.cwd, "next");
  await mkdir(f.workspace.cwd);
  const next = join(f.workspace.cwd, "note.md");
  await writeFile(next, "next note");
  f.published.add(next);
  f.filePreview.maxBytes = 4;
  await expect(read()).resolves.toMatchObject({
    content: "next",
    size: 9,
    truncated: true,
  });
});
