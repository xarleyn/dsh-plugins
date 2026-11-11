import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { DocumentError } from "../errors.js";
import { readZipEntries, readZipEntry } from "../inspect/zip.js";

/** Older renderers retain embedded-font relationships but omit their targets. */
export async function preserveReferenceFonts(
  reference: string,
  output: string,
) {
  const source = await readFile(reference);
  const entries = readZipEntries(source) ?? [];
  const fonts = entries.filter((entry) =>
    /^word\/fonts\/[^/]+\.(?:odttf|ttf|otf)$/iu.test(entry.name),
  );
  if (fonts.length === 0) return;
  const document = await JSZip.loadAsync(await readFile(output));
  const missing = fonts.filter((entry) => !document.file(entry.name));
  if (missing.length === 0) return;
  if (
    missing.length > 128 ||
    missing.reduce((total, entry) => total + entry.uncompressedSize, 0) >
      32 * 1024 * 1024
  )
    throw new DocumentError(
      "RENDER_FAILED",
      "reference fonts exceed the copy budget",
    );
  let types = await document.file("[Content_Types].xml")?.async("string");
  if (types === undefined)
    throw new DocumentError(
      "RENDER_FAILED",
      "rendered DOCX has no content types",
    );
  for (const entry of missing) {
    const bytes = readZipEntry(source, entry);
    if (bytes === undefined || bytes.length !== entry.uncompressedSize)
      throw new DocumentError(
        "RENDER_FAILED",
        "reference font could not be read",
      );
    document.file(entry.name, bytes);
    const extension = entry.name.split(".").at(-1)!.toLowerCase();
    if (
      !new RegExp(`<Default\\b[^>]*Extension=["']${extension}["']`, "iu").test(
        types,
      )
    ) {
      const mime =
        extension === "odttf"
          ? "application/vnd.openxmlformats-officedocument.obfuscatedFont"
          : "application/vnd.ms-opentype";
      types = types.replace(
        "</Types>",
        `<Default Extension="${extension}" ContentType="${mime}"/></Types>`,
      );
    }
  }
  document.file("[Content_Types].xml", types);
  await writeFile(
    output,
    await document.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
  );
}
