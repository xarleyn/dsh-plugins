/**
 * Formats the files panel previews by conversion instead of by bytes.
 *
 * Shared by the Host half (which owns the conversion) and the browser card
 * (which decides whether opening a file should ask for one), so the two cannot
 * drift on what "we can render this" means. Dependency-free on purpose: the
 * card bundle inlines it.
 */

/** OOXML word-processing documents, as the deployment detects them. */
export const QA_WORD_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The media type of the PDF a converted document arrives as. */
export const QA_PDF_MEDIA_TYPE = "application/pdf";

/**
 * Whether the panel asks the Host for a converted PDF rather than rendering the
 * bytes it already holds. Word documents are the whole set: the document
 * pipeline reads them and renders PDF, while its other inputs are already
 * previewable (Markdown as text, PDF through the browser's own viewer).
 */
export function isConvertibleDocument(mediaType: string): boolean {
  return mediaType === QA_WORD_MEDIA_TYPE;
}
