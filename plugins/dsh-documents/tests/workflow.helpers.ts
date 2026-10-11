import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentWorkflowService } from "../src/workflow/service.js";
import { WorkflowStore } from "../src/workflow/store.js";
import { stubProviderSet } from "./helpers/document-providers.js";
import { docxBytes } from "./helpers/document-fixtures.js";

export const CONTENT =
  "# Предложение\n\nПредложение без указания стоимости по решению заказчика.\n\n## Цель\n\nДемо-заказчик получает систему мониторинга.\n\n## Функциональные требования\n\nМониторинг поддерживается базовым модулем.\n\n[Место для скриншота: диаграмма мониторинга]\n";
export const UPDATE = {
  facts: [
    {
      key: "pricingDecision",
      value: "unpriced",
      evidence: {
        source: "human:1",
        quote: "Сейчас нужен документ без стоимости",
      },
    },
    {
      key: "customer",
      value: "Демо-заказчик",
      evidence: { source: "human:1", quote: "Заказчик — Демо-заказчик" },
    },
    {
      key: "projectGoal",
      value: "Мониторинг",
      evidence: { source: "human:1", quote: "Нужен мониторинг" },
    },
    {
      key: "functionalScope",
      value: "Базовый модуль",
      evidence: { source: "human:2", quote: "Только базовый модуль" },
    },
  ],
  requirements: [
    {
      id: "req-1",
      text: "Мониторинг",
      coverage: "full" as const,
      modules: ["core"],
      evidence: [
        {
          source: "docs/product-1.0.md",
          quote: "Базовый модуль поддерживает мониторинг",
          productVersion: "1.0",
        },
      ],
    },
  ],
  excludedModules: ["events"],
  scopeDepth: "minimal" as const,
  unresolved: [] as string[],
};

export async function workflowFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "document-workflow-"));
  const workspaceRoot = path.join(root, "workspace");
  const templates = path.join(workspaceRoot, "templates");
  await mkdir(templates, { recursive: true });
  await writeFile(
    path.join(templates, "manifest.yml"),
    "templates:\n  proposal:\n    docx: ./reference.docx\n    markdown: ./content.md\n    requiredFacts: [customer, projectGoal, functionalScope]\n    requiredSections: [Цель, Функциональные требования]\n  specification:\n    docx: ./reference.docx\n    markdown: ./content.md\n    requiredFacts: [customer, projectGoal, functionalScope]\n    requiredSections: [Цель, Функциональные требования]\n",
  );
  await writeFile(path.join(templates, "content.md"), CONTENT);
  await writeFile(path.join(templates, "reference.docx"), docxBytes());
  const stub = stubProviderSet();
  const runtime = new DocumentRuntime({
    config: resolveDocumentsConfig({ templates: { root: templates } }),
    providers: stub.providers,
  });
  const review = vi.fn(async (_task: string, _session: string) => ({
    pass: true,
    summary: "Verified",
    issues: [] as string[],
  }));
  const store = new WorkflowStore(path.join(root, "host-state"));
  const service = new DocumentWorkflowService(() => runtime, store, { review });
  const scope = { workspaceRoot, sessionId: "session-1" };
  return {
    root,
    templates,
    scope,
    runtime,
    store,
    service,
    stub,
    review,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function ready(
  fixture: Awaited<ReturnType<typeof workflowFixture>>,
  kind: "proposal" | "specification" = "proposal",
) {
  const start = await fixture.service.start(fixture.scope, {
    kind,
    template: kind,
    productVersion: "1.0",
    request: "Сделай документ: нужен мониторинг, без событий",
  });
  const updated = await fixture.service.update(fixture.scope, start.id, {
    ...UPDATE,
    revision: start.revision,
  });
  return fixture.service.draft(
    fixture.scope,
    start.id,
    updated.revision,
    CONTENT,
  );
}
