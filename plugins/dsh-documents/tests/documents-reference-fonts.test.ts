import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { preserveReferenceFonts } from "../src/documents/providers/reference-fonts.js";

it("restores omitted font targets without replacing a font already rendered", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reference-fonts-"));
  try {
    const reference = new JSZip();
    reference.file("word/fonts/font1.odttf", "synthetic font one");
    reference.file("word/fonts/font2.odttf", "reference font two");
    const rendered = new JSZip();
    rendered.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );
    rendered.file("word/fonts/font2.odttf", "rendered font two");
    rendered.file("word/document.xml", "unchanged document");
    const source = path.join(root, "reference.docx");
    const output = path.join(root, "output.docx");
    await writeFile(
      source,
      await reference.generateAsync({ type: "nodebuffer" }),
    );
    await writeFile(
      output,
      await rendered.generateAsync({ type: "nodebuffer" }),
    );
    await preserveReferenceFonts(source, output);
    const actual = await JSZip.loadAsync(await readFile(output));
    expect(await actual.file("word/fonts/font1.odttf")!.async("string")).toBe(
      "synthetic font one",
    );
    expect(await actual.file("word/fonts/font2.odttf")!.async("string")).toBe(
      "rendered font two",
    );
    expect(await actual.file("word/document.xml")!.async("string")).toBe(
      "unchanged document",
    );
    expect(await actual.file("[Content_Types].xml")!.async("string")).toContain(
      'Extension="odttf"',
    );
    const first = await readFile(output);
    await preserveReferenceFonts(source, output);
    expect(await readFile(output)).toEqual(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
