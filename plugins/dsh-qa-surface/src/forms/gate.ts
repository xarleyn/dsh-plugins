import type { Context } from "@deepseek-ai/cordis";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import { formAssert, QaFormError } from "./errors.js";
import { parseFormSchema } from "./schema.js";
import type { QaFormService } from "./service.js";
import type {
  QaFormRecord,
  QaFormSubmission,
  QaFormValidation,
} from "./types.js";

const argsParser = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      request_key: z.string(),
      form: z.unknown(),
    })
    .strict(),
  z.object({ action: z.literal("resume"), form_id: z.string() }).strict(),
  z.object({ action: z.literal("validate"), form: z.unknown() }).strict(),
]);
type CollectionOutcome =
  QaFormSubmission | { status: "paused"; form_id: string; reason: string };
type Outcome = CollectionOutcome | QaFormValidation;
interface Waiter {
  session: string;
  call: string;
  finish: (outcome?: CollectionOutcome) => void;
}

/** A parked tool call is transient. Never reconstruct one from a saved draft. */
export class QaFormGate {
  private readonly waiters = new Map<string, Waiter>();
  private readonly disposers: (() => void)[] = [];
  private closed = false;
  private readonly clients = new Map<string, number>();
  constructor(
    readonly service: () => QaFormService,
    private readonly rootOf: (id: string) => string | undefined,
    private readonly busy: (id: string) => boolean,
    private readonly allowed: (exec: ToolExecution) => boolean,
    private readonly filesAvailable: () => boolean = () => false,
  ) {}
  install(ctx: Context): void {
    this.disposers.push(
      ctx.on("agent/disposed", ({ agent }) =>
        this.cancel(String(agent.session.id)),
      ),
      ctx.on("agent/status", ({ agent, status }) => {
        if (status === "idle") this.cancel(String(agent.session.id));
      }),
    );
  }
  waiting(id: string): boolean {
    return this.waiters.has(id);
  }
  touch(session: string): void {
    this.clients.set(session, Date.now());
  }
  private clientReady(session: string): boolean {
    return Date.now() - (this.clients.get(session) ?? 0) < 30000;
  }
  hasSession(session: string): boolean {
    return [...this.waiters.values()].some((w) => w.session === session);
  }
  async request(raw: unknown, exec: ToolExecution): Promise<Outcome> {
    const parsed = argsParser.safeParse(raw);
    formAssert(
      parsed.success,
      "INVALID_SCHEMA",
      "Provide create with request_key and form, validate with form, or resume with form_id.",
    );
    exec.signal.throwIfAborted();
    formAssert(
      !this.closed && this.allowed(exec),
      "INTERACTION_UNAVAILABLE",
      "An interactive QA form is unavailable for this request.",
    );
    const agentId =
        exec.agent === undefined ? "" : String(exec.agent.session.id),
      session = this.rootOf(agentId);
    formAssert(
      session &&
        session === agentId &&
        exec.agent?.session.header.origin !== "subagent",
      "ACCESS_DENIED",
      "Only the main agent of an admitted QA chat can request a form. Ask the main agent to collect the input.",
    );
    const service = this.service();
    service.enabled();
    const args = parsed.data;
    if (args.action === "validate") {
      const result: QaFormValidation = {
        status: "validated",
        valid: false,
        interactive_client_ready: this.clientReady(session),
        file_upload_available: this.filesAvailable(),
        policy: service.policy(),
        issues: [],
      };
      try {
        parseFormSchema(args.form, result.policy);
        result.valid = true;
      } catch (error) {
        if (!(error instanceof QaFormError) || error.code !== "INVALID_SCHEMA")
          throw error;
        result.issues = error.schemaIssues ?? [
          { path: "form", code: error.code, message: error.message },
        ];
      }
      return result;
    }
    formAssert(
      this.clientReady(session),
      "INTERACTION_UNAVAILABLE",
      "No recent QA form poll was received for this chat. If the chat is already open in QA, reload it and retry; form loading or the connection may have failed. Otherwise open the chat in QA. This does not indicate a schema error.",
    );
    formAssert(
      !this.hasSession(session) && !this.busy(session),
      "INTERACTION_BUSY",
      "Finish the current interactive request before opening this form.",
    );
    if (args.action === "create" && !this.filesAvailable()) {
      const schema = parseFormSchema(args.form, service.policy());
      formAssert(
        schema.steps.every((s) =>
          s.items.every((i) => i.files.requirement === "none"),
        ),
        "INTERACTION_UNAVAILABLE",
        "This deployment has no authenticated form-file upload and reader pipeline.",
      );
    }
    const r =
      args.action === "create"
        ? service.create(session, args.request_key, args.form)
        : service.get(session, args.form_id);
    formAssert(
      this.filesAvailable() ||
        r.schema.steps.every((s) =>
          s.items.every((i) => i.files.requirement === "none"),
        ),
      "INTERACTION_UNAVAILABLE",
      "This deployment has no authenticated form-file upload and reader pipeline.",
    );
    service.store.editableOrSubmitted(r);
    if (r.submission) return r.submission;
    formAssert(
      !this.waiters.has(r.id) &&
        !this.hasSession(session) &&
        !this.busy(session),
      "INTERACTION_BUSY",
      "Finish the current interactive request before opening this form.",
    );
    return new Promise<CollectionOutcome>((resolve, reject) => {
      const abort = () => finish();
      const finish = (outcome?: CollectionOutcome) => {
        if (!this.waiters.delete(r.id)) return;
        exec.signal.removeEventListener("abort", abort);
        if (outcome === undefined)
          reject(
            exec.signal.aborted
              ? exec.signal.reason
              : new QaFormError(
                  "INTERACTION_CANCELLED",
                  "Form collection stopped. The draft remains available for resume.",
                ),
          );
        else if (!this.allowed(exec))
          reject(
            new QaFormError(
              "ACCESS_DENIED",
              "Form access is no longer available.",
            ),
          );
        else resolve(outcome);
      };
      this.waiters.set(r.id, { session, call: String(exec.callId), finish });
      exec.signal.addEventListener("abort", abort, { once: true });
      if (exec.signal.aborted) abort();
    });
  }
  notify(record: QaFormRecord, pause = false): void {
    const waiter = this.waiters.get(record.id);
    if (record.submission) waiter?.finish(record.submission);
    else if (pause)
      waiter?.finish({
        status: "paused",
        form_id: record.id,
        reason: "Draft saved. Resume this form; collection is not complete.",
      });
  }
  cancel(session: string): void {
    for (const w of [...this.waiters.values()])
      if (w.session === session) w.finish();
  }
  cancelAll(): void {
    for (const w of [...this.waiters.values()]) w.finish();
  }
  dispose(): void {
    this.closed = true;
    for (const w of [...this.waiters.values()]) w.finish();
    for (const d of this.disposers.splice(0)) d();
  }
}
