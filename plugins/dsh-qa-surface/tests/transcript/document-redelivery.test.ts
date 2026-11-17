import { expect, it } from "vitest";
import {
  requestedDocument,
  requestedDocumentAttachment,
} from "../../src/shared/document-redelivery.js";

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
  [
    "QA — Redeliver the existing file by its full exact name: report.docx. Reuse the existing artifact without editing or regenerating it. State its SHA-256 and source count.",
    "report.docx",
  ],
  ["Пришли report.docx и укажи SHA-256 и число источников", "report.docx"],
  ["send report.docx; summarize it", "report.docx"],
  ["send report.docx and create summary.docx", "report.docx"],
  [
    'Summarize the result and resend "Report and Summary.docx".',
    "report and summary.docx",
  ],
])(
  "attaches a known output without consuming a compound request: %s",
  (text, name) => {
    expect(requestedDocument(text)).toBeUndefined();
    expect(requestedDocumentAttachment(text)).toBe(name);
  },
);

it.each([
  "Edit report.docx then resend report.docx",
  "QA — Edit report.docx; then resend report.docx",
  "Отредактируй report.docx и пришли report.docx",
  "Поправь report.docx и пришли report.docx",
  "пришли report.docx и исправь значения",
  "send report.docx with changes",
  "Do not send report.docx; summarize the result",
  "send ../report.docx and state SHA-256",
  "send one.docx and resend two.docx",
])(
  "never substitutes an old attachment for a modification, refusal or ambiguous delivery: %s",
  (text) => {
    expect(requestedDocumentAttachment(text)).toBeUndefined();
  },
);
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
