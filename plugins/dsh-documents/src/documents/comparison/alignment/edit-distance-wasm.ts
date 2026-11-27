import { readFileSync } from "node:fs";

export const CHARACTER_LIMIT = 512;

type Distance = (left: string, right: string) => number;
let distance: Distance | null | undefined;

function load(): Distance | null {
  try {
    const bytes = readFileSync(
      new URL("../../../../native/edit-distance.wasm", import.meta.url),
    );
    const { memory, input_ptr, distance_utf16 } = new WebAssembly.Instance(
      new WebAssembly.Module(bytes),
    ).exports;
    if (
      !(memory instanceof WebAssembly.Memory) ||
      typeof input_ptr !== "function" ||
      typeof distance_utf16 !== "function"
    )
      return null;
    const ptr = Number(input_ptr());
    // RapidFuzz can allocate while scoring. If memory grows, the old JS view
    // detaches, so rebuild it on the next invocation when the buffer changes.
    let input = new Uint16Array(memory.buffer, ptr, 2 * CHARACTER_LIMIT);
    return (left, right) => {
      if (input.buffer !== memory.buffer)
        input = new Uint16Array(memory.buffer, ptr, 2 * CHARACTER_LIMIT);
      for (let i = 0; i < left.length; i++) input[i] = left.charCodeAt(i);
      for (let i = 0; i < right.length; i++)
        input[CHARACTER_LIMIT + i] = right.charCodeAt(i);
      return Number(distance_utf16(left.length, right.length));
    };
  } catch {
    return null;
  }
}

export function wasmEditDistance(
  left: string,
  right: string,
): number | undefined {
  if (left.length > CHARACTER_LIMIT || right.length > CHARACTER_LIMIT)
    return undefined;
  if (distance === undefined) distance = load();
  return distance?.(left, right);
}
