export interface DecorationRecord {
  kind: string;
  name: string;
  isStatic: boolean;
  hasAddInitializer: boolean;
}

/** What every lowering of a standard decorator has to leave behind. */
export const decorated: DecorationRecord[] = [];

/** The signature typert's `@Remote` takes: a standard method decorator. */
function Track(
  value: (...args: string[]) => string,
  context: ClassMethodDecoratorContext,
): (...args: string[]) => string {
  decorated.push({
    kind: context.kind,
    name: String(context.name),
    isStatic: context.static,
    hasAddInitializer: typeof context.addInitializer === "function",
  });
  return value;
}

export class DecoratedHost {
  @Track greet(name: string): string {
    return `hello ${name}`;
  }
}
