/**
 * The admin console's route model.
 *
 * The console lives under one host route (`/qa/admin`) and gives every entity
 * with its own identity its own path, because a review finding is something
 * people paste into a chat. Parsing and serializing live here, away from the
 * components, so the mapping is testable without a DOM.
 */

export type QaAdminRoute =
  | { readonly page: "overview" }
  | { readonly page: "users" }
  | { readonly page: "user"; readonly userId: string }
  | { readonly page: "subroles" }
  | { readonly page: "skills" }
  | { readonly page: "common" }
  | { readonly page: "conversations" }
  | {
      readonly page: "conversation";
      readonly conversationId: string;
      /** Deep link to one message inside the conversation (spec §34). */
      readonly messageId?: string;
    }
  | { readonly page: "review" }
  | { readonly page: "feedback" }
  | { readonly page: "quality" }
  | { readonly page: "audit" };

/** The console's own base path under the surface route. */
export function adminBasePath(routePath: string): string {
  return `${routePath === "/" ? "" : routePath}/admin`;
}

/**
 * Whether a pathname addresses the console at all. Sections and entities each
 * own a path under the base ({@link adminPath}), and the surface hosting the
 * console must stay the console while any of them is open, so the test is by
 * prefix. An equality test against the base alone unmounts the console on the
 * first navigation inside it, and every deep link lands in the chat instead.
 */
export function isAdminPath(pathname: string, routePath: string): boolean {
  const base = adminBasePath(routePath);
  const trimmed = pathname.replace(/\/+$/u, "");
  return trimmed === base || trimmed.startsWith(`${base}/`);
}

/** Path segments after `/qa/admin`, without the leading slash. */
export function adminSegments(pathname: string, routePath: string): string[] {
  const base = adminBasePath(routePath);
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  return rest
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

/**
 * Resolve a pathname into a console route. Unknown segments fall back to the
 * section they live under rather than to an error page: a stale link should
 * still land the reviewer somewhere useful.
 */
export function parseAdminRoute(
  pathname: string,
  routePath: string,
): QaAdminRoute {
  const segments = adminSegments(pathname, routePath);
  const [section, ...rest] = segments;
  const param = rest[0];
  switch (section) {
    case undefined:
    case "":
      return { page: "overview" };
    case "users":
      return param === undefined
        ? { page: "users" }
        : { page: "user", userId: decodeURIComponent(param) };
    case "access":
      if (rest[0] === "common") return { page: "common" };
      if (rest[0] === "skills") return { page: "skills" };
      return { page: "subroles" };
    case "subroles":
      return { page: "subroles" };
    case "skills":
      return { page: "skills" };
    case "common":
      return { page: "common" };
    case "conversations":
      return param === undefined
        ? { page: "conversations" }
        : {
            page: "conversation",
            conversationId: decodeURIComponent(param),
            ...(rest[1] === undefined
              ? {}
              : { messageId: decodeURIComponent(rest[1]) }),
          };
    case "review":
      return { page: "review" };
    case "quality":
      return rest[0] === "analytics"
        ? { page: "quality" }
        : { page: "feedback" };
    case "feedback":
      return { page: "feedback" };
    case "analytics":
      return { page: "quality" };
    case "audit":
      return { page: "audit" };
    default:
      return { page: "overview" };
  }
}

/** The pathname for one console route; the inverse of {@link parseAdminRoute}. */
export function adminPath(
  routePath: string,
  route: QaAdminRoute,
  search = "",
): string {
  const base = adminBasePath(routePath);
  const suffix = (() => {
    switch (route.page) {
      case "overview":
        return "";
      case "users":
        return "/users";
      case "user":
        return `/users/${encodeURIComponent(route.userId)}`;
      case "subroles":
        return "/access/subroles";
      case "skills":
        return "/access/skills";
      case "common":
        return "/access/common";
      case "conversations":
        return "/conversations";
      case "conversation":
        return `/conversations/${encodeURIComponent(route.conversationId)}${
          route.messageId === undefined
            ? ""
            : `/${encodeURIComponent(route.messageId)}`
        }`;
      case "review":
        return "/review";
      case "feedback":
        return "/quality/feedback";
      case "quality":
        return "/quality/analytics";
      case "audit":
        return "/audit";
    }
  })();
  return `${base}${suffix}${search}`;
}

/** Which navigation entry is current for one route. */
export function adminSectionOf(
  route: QaAdminRoute,
):
  | "overview"
  | "users"
  | "access"
  | "conversations"
  | "review"
  | "feedback"
  | "quality"
  | "audit" {
  switch (route.page) {
    case "user":
    case "users":
      return "users";
    case "subroles":
    case "skills":
    case "common":
      return "access";
    case "conversation":
    case "conversations":
      return "conversations";
    case "feedback":
      return "feedback";
    default:
      return route.page;
  }
}
