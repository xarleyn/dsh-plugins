/**
 * Path safety for values that end up inside an upstream REST path. Each
 * provider keeps its own segment grammar — what a project path or a component
 * slug may contain — and the predicate here answers the question every grammar
 * shares: whether a `.` or `..` segment could walk out of the path the provider
 * meant to compose. Providers refuse such a value as an invalid argument.
 */

/** Whether any `/`-separated segment of the value is `.` or `..`. */
export function hasTraversal(value: string): boolean {
  return value
    .split("/")
    .some((segment) => segment === ".." || segment === ".");
}
