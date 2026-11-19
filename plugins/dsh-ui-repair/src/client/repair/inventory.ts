import type { Context } from "@deepseek-ai/cordis";
import { versionedPackage } from "../../shared/recipes.js";

interface Bundle {
  readonly name: string;
  readonly version?: string;
  readonly availability: string;
  readonly enabled: boolean;
  readonly error?: unknown;
}

// Keep this read optional on hosts where plugin management is unavailable.
interface InventoryRemote {
  readonly pluginManager: {
    listBundles(): Promise<{
      readonly ok: boolean;
      readonly value?: readonly Bundle[];
    }>;
  };
  $on(event: "plugin-manager/changed", callback: () => void): () => void;
}

export function bindRepairInventory(
  ctx: Context,
  publish: (versions: ReadonlyMap<string, string>) => void,
): () => void {
  const fiber = ctx.inject(["remote", "remote.pluginManager"], (context) => {
    const remote = context.get("remote") as InventoryRemote | undefined;
    if (typeof remote?.pluginManager?.listBundles !== "function") return;
    let revision = 0;
    let active = true;
    const refresh = () => {
      const requested = ++revision;
      publish(new Map());
      void remote.pluginManager
        .listBundles()
        .then((result) => {
          if (
            !active ||
            revision !== requested ||
            !result.ok ||
            !Array.isArray(result.value)
          )
            return;
          const versions = new Map<string, string>();
          const duplicates = new Set<string>();
          for (const bundle of result.value as readonly Bundle[]) {
            if (
              !bundle.enabled ||
              bundle.error !== undefined ||
              (bundle.availability !== "profile" &&
                bundle.availability !== "installation") ||
              typeof bundle.version !== "string" ||
              !versionedPackage(bundle.name, bundle.version)
            )
              continue;
            if (versions.has(bundle.name)) duplicates.add(bundle.name);
            versions.set(bundle.name, bundle.version);
          }
          for (const name of duplicates) versions.delete(name);
          publish(versions);
        })
        .catch(() => undefined);
    };
    const offChanged = remote.$on("plugin-manager/changed", refresh);
    const offReset = context.on("connection/reset", refresh);
    refresh();
    return () => {
      active = false;
      offChanged();
      offReset();
      publish(new Map());
    };
  });
  return () => {
    void fiber.dispose();
  };
}
