import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QaFormStore } from "../../src/forms/store.js";
import { QaFormService } from "../../src/forms/service.js";
import { DEFAULT_FORM_POLICY } from "../../src/forms/schema.js";
import type { QaFormCommand, QaFormPolicy } from "../../src/forms/types.js";
import { intake, textOnly } from "./schemas.js";

export { intake, textOnly };
export function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-forms-")),
    file = path.join(dir, "forms.db");
  let store = new QaFormStore(file);
  let policy: QaFormPolicy = { ...DEFAULT_FORM_POLICY, enabled: true };
  const service = () => new QaFormService(store, () => policy);
  let seq = 0;
  return {
    dir,
    file,
    get store() {
      return store;
    },
    get service() {
      return service();
    },
    policy: (next: Partial<QaFormPolicy>) => {
      policy = { ...policy, ...next };
    },
    command(id: string, op: Record<string, unknown>, session = "chat-a") {
      return service().command(session, {
        ...op,
        form_id: id,
        expected_revision: store.get(session, id).revision,
        mutation_id: `mutation_${++seq}`,
      } as QaFormCommand);
    },
    restart() {
      store.close();
      store = new QaFormStore(file);
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
