/**
 * Package gate for @yadsh/dsh-l10n-overrides.
 *
 * Validates the client-surface manifest and the packaged files. The shared
 * checks come from @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-l10n-overrides",
  exports: [".", "./client", "./types", "./package.json"],
  client: { platform: "web", injectEquals: ["@deepseek-ai/dsh-client-locale"] },
  files: ["cordis.patch.yml", "README.md", "LICENSE"],
  requiredFiles: ["cordis.patch.yml", "README.md", "LICENSE"],
});
