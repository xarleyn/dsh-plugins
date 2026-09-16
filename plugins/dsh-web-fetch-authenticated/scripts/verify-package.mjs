/**
 * Package gate for @yadsh/dsh-web-fetch-authenticated.
 *
 * The shared manifest/patch/client checks and the canonical card shell
 * contract (verify-plugin-card-contract) come from
 * @yadsh/dsh-plugin-scripts/run-verify-package; the credentials
 * write-only contract and the provider seam stay local.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-web-fetch-authenticated",
  requiredFiles: [
    "lib/index.js",
    "lib/client.js",
    "lib/typert.host.js",
    "lib/typert.host.d.ts",
    "lib/typert.remote-client.js",
    "lib/typert.remote-client.d.ts",
    "lib/types/index.d.ts",
    "lib/types/client/index.d.ts",
    "cordis.patch.yml",
  ],
  patch: { id: "web-fetch-authenticated" },
  client: { platform: "web" },
  clientBundle: {
    moduleLoaderId: true,
    // The credentials control must stay write-only: no component state may
    // hold a fetched credential value, and the secret input never echoes
    // stored values. The tester/diagnostics render only sanitized report
    // fields.
    notMatches: [/credentials\.value/u, /credentialValue/u],
    matches: [/type: "password"/u, /authApplied/u],
    cardContract: {
      legacyPatterns: [/\.wfa-card\{/u, /\.dsh-plugin-card \*/u],
    },
  },
  extra: async ({ client, readFile }) => {
    // `remote.credentials` is its own Cordis service key, not a field of `remote`:
    // reading it without declaring it in the client `inject` list throws
    // "cannot get property ... without inject", which fails the whole browser-side
    // plugin and leaves the Plugins page without this card.
    const clientInject = /const inject = \[([^\]]*)\]/u.exec(client);
    assert.notEqual(
      clientInject,
      null,
      "client bundle must export an inject list",
    );
    assert.match(
      clientInject[1],
      /"remote\.credentials"/u,
      "the client must declare the remote.credentials service",
    );

    // Host entry registers the provider under the seam-facing id `authenticated`.
    const entry = await readFile("lib/index.js");
    assert.match(entry, /registerFetchProvider/u);
    const providerModule = await readFile("lib/provider.js");
    assert.match(
      providerModule,
      /AUTHENTICATED_FETCH_PROVIDER_ID = ["']authenticated["']/u,
    );
  },
});
