import { expect, it } from "vitest";
import { requestedDocument } from "../../src/shared/document-redelivery.js";

it.each([
  ["resend please-report.docx", "please-report.docx"],
  ["send again.docx please", "again.docx"],
  ["пришли снова-отчет.docx", "снова-отчет.docx"],
  ["Пришлите, пожалуйста, report.docx", "report.docx"],
  ["пришли файл ещё раз", ""],
  ["Please resend the same report.docx again", "report.docx"],
  ['resend "please report.docx"', "please report.docx"],
  ['send "report and summary.docx"', "report and summary.docx"],
])("preserves filenames and standalone delivery: %s", (text, name) => {
  expect(requestedDocument(text)).toBe(name);
});
it.each([
  "send report.docx and create summary.docx",
  "send report.docx, create summary.docx",
  "пришли report.docx и создай summary.docx",
  "send report.docx with changes.docx",
  "attach report.docx then update summary.docx",
  "исправь и пришли файл ещё раз",
  "send report.docx; summarize it",
])("keeps compound requests on the native prompt path: %s", (text) => {
  expect(requestedDocument(text)).toBeUndefined();
});
