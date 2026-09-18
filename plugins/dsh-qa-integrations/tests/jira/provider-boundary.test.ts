import { IntegrationError } from "../../src/errors.js";
import { JiraProvider } from "../../src/providers/jira/index.js";
import {
  COMPANY,
  MYSELF,
  SANDBOX,
  TOKEN,
  cloud,
  config,
  credentialFor,
  providerFor,
  stub,
} from "./shared.js";

describe("provider boundary of this suite", () => {
  it("keeps the token out of every tool result", async () => {
    const { fetcher } = cloud(() => ({ json: MYSELF }));
    const provider = providerFor(fetcher);
    const answer = await provider.execute(
      { credential: credentialFor(provider) },
      "connection.get",
      {},
    );
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(JSON.stringify(answer)).not.toContain("Basic ");
  });

  it("fails closed when the stored credential names another site", async () => {
    const { fetcher, calls } = stub(() => ({ json: MYSELF }));
    const provider = providerFor(fetcher);
    const credential = credentialFor(provider, SANDBOX.id);
    const narrowed = new JiraProvider(config({ sites: [COMPANY] }), fetcher);
    await expect(
      narrowed.execute({ credential }, "connection.get", {}),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    expect(calls).toEqual([]);
  });

  it("turns an unsupported operation into a safe domain error", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    const error = await provider
      .execute({ credential: credentialFor(provider) }, "issues.create", {})
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).message).not.toContain(TOKEN);
  });
});
