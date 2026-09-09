import { SafetyClassifierService, type ClassifierTransport } from "../../src/classifier/service.js";
import { SafetyMetrics, type SafetyMetricsSnapshot } from "../../src/audit/metrics.js";
import { resolveSafetyGateConfig, type ModelSafetyGateConfig } from "../../src/config.js";
import { CheckPipeline } from "../../src/pipeline.js";
import { SafetyScanner } from "../../src/rules/scanner.js";
import { SAFETY_EVENT_TYPES, type SafetyAuditEvent, type SafetyEventType } from "../../src/audit/events.js";
import { VERDICT_VERSION, type SafetyVerdict } from "../../src/types.js";

export interface TestGate {
  readonly pipeline: CheckPipeline;
  readonly metrics: SafetyMetrics;
  readonly events: Array<{ type: SafetyEventType; event: SafetyAuditEvent }>;
  readonly config: ReturnType<typeof resolveSafetyGateConfig>;
  readonly classifierCalls: { count: number; contents: string[] };
}

export interface MakeGateOptions {
  readonly config?: ModelSafetyGateConfig;
  /** Verdict returned by the fake classifier transport. */
  readonly verdict?: SafetyVerdict | null;
  /** Transport delay in ms (for timeout tests). */
  readonly transportDelayMs?: number;
  /** Fully custom transport override (takes precedence over `verdict`). */
  readonly transport?: ClassifierTransport | null;
}

export function fakeVerdict(decision: SafetyVerdict["decision"] = "allow"): SafetyVerdict {
  return { version: VERDICT_VERSION, decision, confidence: 0.8, categories: [], summary: "fake" };
}

export function makeTestGate(options: MakeGateOptions = {}): TestGate {
  const config = resolveSafetyGateConfig(options.config ?? {});
  const metrics = new SafetyMetrics();
  const events: TestGate["events"] = [];
  const classifierCalls = { count: 0, contents: [] as string[] };

  let transport: ClassifierTransport | null;
  if (config.classifier.backend === "none") {
    transport = null;
  } else if (options.transport !== undefined) {
    transport = options.transport;
  } else if (options.verdict !== null) {
    transport = async (request) => {
      classifierCalls.count += 1;
      classifierCalls.contents.push(request.prompt);
      if (options.transportDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.transportDelayMs));
      }
      const verdict = options.verdict ?? fakeVerdict("allow");
      return {
        text: JSON.stringify({
          decision: verdict.decision,
          confidence: verdict.confidence,
          categories: [...verdict.categories],
          summary: verdict.summary,
        }),
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    };
  } else {
    transport = null;
  }
  const classifier =
    transport === null
      ? null
      : new SafetyClassifierService({
          transport,
          timeoutMs: config.classifier.timeoutMs,
          maxTokens: config.classifier.maxTokens,
          temperature: config.classifier.temperature,
          failureMode: config.classifier.failureMode,
        });

  const pipeline = new CheckPipeline({
    scanner: new SafetyScanner({ maxScanChars: config.maxScanChars, customBlockPatterns: config.customBlockPatterns }),
    classifier,
    config,
    metrics,
    emit: (type, event) => {
      events.push({ type, event });
    },
  });

  return { pipeline, metrics, events, config, classifierCalls };
}

export { SAFETY_EVENT_TYPES };
export type SafetyMetricsSnapshotAlias = SafetyMetricsSnapshot;
