/** The Host tool contract, normalized once for path and storage policy. */
export type QaFilesystemIntent =
  | {
      readonly kind: "read";
      readonly path: string;
      readonly fileOnlyGrant: boolean;
    }
  | { readonly kind: "write"; readonly path: string; readonly bytes: number };

export function qaFilesystemIntent(
  name: string,
  args: Record<string, unknown> | undefined,
): QaFilesystemIntent | undefined {
  if (args === undefined) return undefined;
  const file = typeof args.file_path === "string" ? args.file_path : undefined;
  const target = typeof args.path === "string" ? args.path : undefined;
  const bytes = (value: unknown) =>
    typeof value === "string" ? Buffer.byteLength(value) : 0;
  switch (name) {
    case "read":
    case "read_image":
      return file === undefined
        ? undefined
        : { kind: "read", path: file, fileOnlyGrant: true };
    case "glob":
    case "grep":
      return { kind: "read", path: target ?? ".", fileOnlyGrant: false };
    case "write":
    case "edit":
      return file === undefined
        ? undefined
        : {
            kind: "write",
            path: file,
            bytes: bytes(name === "write" ? args.content : args.new_string),
          };
    case "str_replace_editor":
      if (target === undefined) return undefined;
      if (args.command === "view")
        return { kind: "read", path: target, fileOnlyGrant: true };
      return {
        kind: "write",
        path: target,
        bytes: bytes(args.command === "create" ? args.file_text : args.new_str),
      };
    default:
      return undefined;
  }
}
