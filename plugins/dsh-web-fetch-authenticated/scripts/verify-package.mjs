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
      // The card mounts on the plugin's own row page of the Plugins panel:
      // the keyed `settings.plugins.tab` seat of the old settings section is
      // gone, and the entry registers into `plugins.row.config`.
      /"plugins\.row\.config"/u,
      /*
       * The page opens a seat by `<package name>#<row id>`, and the row id is the
       * `cordis.patch.yml` row — the same string as the `ctx.configForms`
       * namespace, so a value saved before the move keeps reading under it. Only
       * the two halves are asserted: how the source spells them (a template, a
       * literal, one line or two) is the bundler's and the editor's business, and
       * `client-registration.test.ts` pins the assembled runtime key against
       * `package.json` and `cordis.patch.yml` instead.
       */
      /@yadsh\/dsh-web-fetch-authenticated#/u,
      /key:\s*WEB_FETCH_AUTH_ROW_CONFIG_KEY/u,
      /WEB_FETCH_AUTH_SETTINGS_NAMESPACE\s*=\s*"web-fetch-authenticated"/u,
      /configForms\.get\(/u,
      /*
       * The page seats this one entry twice, and the seat contract asks an entry
       * to answer both views (`slot-contract.ts`). The summary answer has to stay
       * a sentence: mounting the body there puts a page inside a line of text and
       * opens a second poll of the Remote. It is the fallback for the row's
       * description line — for this row the page prints the `description` read
       * off the bundle's manifest instead (`@deepseek-ai/dsh-app-boot`
       * `src/package-meta.ts:157`) — and the `page` answer prints neither that
       * line nor a heading of its own, since the page already drew both above the
       * body. Which text lands where is asserted rendered, in
       * `client-card.test.tsx`.
       */
      /WEB_FETCH_AUTH_ROW_SUMMARY\s*=\s*"Per-origin authenticated rules for web_fetch/u,
      /if \(view === "summary"\)\s*return WEB_FETCH_AUTH_ROW_SUMMARY/u,
    ],
    cardContract: {
      legacyPatterns: [
        /\.wfa-card\{/u,
        /\.dsh-plugin-card \*/u,
        // The body sits in the page's own section: no list wrapper of ours.
        /["']wfa-cards/u,
      ],
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
