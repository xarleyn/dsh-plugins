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
    notMatches: [
      /credentials\.value/u,
      /credentialValue/u,
      // The row's facts are separated by layout, not by a middle dot glyph.
      /" · "/u,
      // A rule that accepts either scheme prints the compact token instead.
      /https\/http/u,
      // The four row actions are icon buttons; the text-button class is gone.
      /wfa-btn link/u,
    ],
    matches: [
      /type: "password"/u,
      /authApplied/u,
      /viewBox: "0 0 14 14"/u,
      /wfa-icon-btn/u,
      /"http\(s\)"/u,
    ],
    cardContract: {
      legacyPatterns: [/\.wfa-card\{/u, /\.dsh-plugin-card \*/u],
    },
  },
  extra: async ({ client, readFile }) => {
    // An icon is not a name: every rule-row action goes through IconButton,
    // which renders the label into `aria-label` and `title` (the glyph itself
    // is `aria-hidden`). A fifth action added later must do the same, and the
    // bundle proves the four that exist do.
    assert.match(
      client,
      /"aria-label": label/u,
      "rule-row actions must carry an accessible name",
    );
    for (const action of ["Test", "Edit", "Delete"]) {
      assert.match(
        client,
        new RegExp(`label: "${action}"`, "u"),
        `the ${action} action must be an icon button`,
      );
    }
    assert.match(
      client,
      /label: rule\.enabled \? "Disable" : "Enable"/u,
      "the enable/disable action must be an icon button",
    );

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
