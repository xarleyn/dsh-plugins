import { resolveConfig } from "../../src/config.js";
import { Bitrix24Provider } from "../../src/providers/bitrix24/index.js";
import { CREDENTIAL } from "./shared.js";

/**
 * The provider-level proof that the Bitrix24 transport *uses* the shared
 * reader: the fine-grained boundary cases of that reader live in
 * `tests/provider-http.test.ts`, and what matters here is the wiring and the
 * order of the transport's own decisions.
 */
const JSON_HEADERS = { "content-type": "application/json" };

function providerFor(
  response: () => Response,
  maxResponseBytes?: number,
): Bitrix24Provider {
  const fetcher: typeof fetch = async () => response();
  return new Bitrix24Provider(
    maxResponseBytes === undefined
      ? resolveConfig()
      : resolveConfig({ maxResponseBytes }),
    fetcher,
  );
}

function readProfile(provider: Bitrix24Provider): Promise<unknown> {
  return provider.execute({ credential: CREDENTIAL }, "crm.get", {
    entityTypeId: 2,
    id: 9,
  });
}

describe("bitrix24 transport", () => {
  it("reads one bounded body through the shared reader", async () => {
    const provider = providerFor(
      () =>
        new Response(JSON.stringify({ result: { ID: "7" } }), {
          status: 200,
          headers: JSON_HEADERS,
        }),
    );
    await expect(readProfile(provider)).resolves.toMatchObject({ ID: "7" });
  });

  it("folds a body over the deployment limit into ResultTooLarge", async () => {
    const provider = providerFor(
      () =>
        new Response(JSON.stringify({ result: { ID: "7".repeat(64) } }), {
          status: 200,
          headers: JSON_HEADERS,
        }),
      64,
    );
    await expect(readProfile(provider)).rejects.toMatchObject({
      code: "ResultTooLarge",
    });
  });

  it("answers with the status error instead of reading a failed body", async () => {
    const provider = providerFor(
      () =>
        new Response(JSON.stringify({ error: "insufficient_scope" }), {
          status: 403,
          headers: { ...JSON_HEADERS, "content-length": "4000000" },
        }),
      64,
    );
    await expect(readProfile(provider)).rejects.toMatchObject({
      code: "ProviderPermissionDenied",
    });
  });
});
