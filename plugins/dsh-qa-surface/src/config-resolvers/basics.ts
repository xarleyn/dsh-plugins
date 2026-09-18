import type {
  QaQuestionInteraction,
  QaQuestionInteractionInput,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { optionalText } from "./shared.js";

/**
 * One name in the resolved config: the `enabled` spelling a deployment may
 * write for the question seam resolves to `interactive`, which is what every
 * reader below compares against.
 */
function resolveQuestionInteraction(
  value: QaQuestionInteractionInput | undefined,
): QaQuestionInteraction {
  if (value === "enabled") return "interactive";
  return value ?? DEFAULT_QA_SURFACE_CONFIG.interaction.questions;
}

export function normalizeRoutePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || !trimmed.startsWith("/")) {
    throw new TypeError("dsh-qa-surface: route.path must start with /");
  }
  const path = trimmed.length > 1 ? trimmed.replace(/\/+$/u, "") : trimmed;
  if (path === "/") {
    throw new TypeError(
      "dsh-qa-surface: route.path cannot replace the operator root",
    );
  }
  if (path === "/api" || path.startsWith("/api/")) {
    throw new TypeError("dsh-qa-surface: route.path cannot claim /api");
  }
  if (path === "/plugins" || path.startsWith("/plugins/")) {
    throw new TypeError("dsh-qa-surface: route.path cannot claim /plugins");
  }
  return path;
}

/** The scalar domains that carry no table-shaped or cross-domain rules. */
type BasicsSlice = Pick<
  ResolvedQaSurfaceConfig,
  "enabled" | "route" | "branding" | "embedding" | "entry" | "interaction"
>;

/** Resolve the master switch, route, branding, embedding, and entry domains. */
export function resolveBasics(input: QaSurfaceConfig): BasicsSlice {
  return {
    enabled: input.enabled ?? DEFAULT_QA_SURFACE_CONFIG.enabled,
    route: Object.freeze({
      path: normalizeRoutePath(
        input.route?.path ?? DEFAULT_QA_SURFACE_CONFIG.route.path,
      ),
      matchChildren:
        input.route?.matchChildren ??
        DEFAULT_QA_SURFACE_CONFIG.route.matchChildren,
    }),
    branding: Object.freeze({
      title:
        input.branding?.title?.trim() ||
        DEFAULT_QA_SURFACE_CONFIG.branding.title,
      subtitle: input.branding?.subtitle?.trim() ?? "",
      welcomeMessage:
        input.branding?.welcomeMessage?.trim() ??
        DEFAULT_QA_SURFACE_CONFIG.branding.welcomeMessage,
      placeholder:
        input.branding?.placeholder?.trim() ||
        DEFAULT_QA_SURFACE_CONFIG.branding.placeholder,
      logoUrl: optionalText(input.branding?.logoUrl),
      // Undefined falls back to the default notice; an explicit null or
      // empty string hides the plate entirely.
      disclaimer:
        input.branding?.disclaimer === undefined
          ? DEFAULT_QA_SURFACE_CONFIG.branding.disclaimer
          : (optionalText(input.branding.disclaimer) ?? ""),
    }),
    embedding: Object.freeze({
      frameAncestors: optionalText(input.embedding?.frameAncestors),
    }),
    entry: Object.freeze({
      redirectNonLoopback:
        input.entry?.redirectNonLoopback ??
        DEFAULT_QA_SURFACE_CONFIG.entry.redirectNonLoopback,
      cookieBootstrap:
        input.entry?.cookieBootstrap ??
        DEFAULT_QA_SURFACE_CONFIG.entry.cookieBootstrap,
    }),
    interaction: Object.freeze({
      approvals:
        input.interaction?.approvals ??
        DEFAULT_QA_SURFACE_CONFIG.interaction.approvals,
      questions: resolveQuestionInteraction(input.interaction?.questions),
    }),
  };
}
