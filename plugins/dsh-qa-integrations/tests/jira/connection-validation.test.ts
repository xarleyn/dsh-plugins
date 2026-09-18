import { JiraProvider } from "../../src/providers/jira/index.js";
import {
  COMPANY,
  EMAIL,
  MYSELF,
  SANDBOX,
  TOKEN,
  cloud,
  config,
  credentialFor,
  providerFor,
  stub,
} from "./shared.js";

describe("jira connection validation", () => {
  it("reports the account behind the token and the site it lives on", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    const validation = await provider.validate({
      credential: credentialFor(provider),
    });
    expect(validation.tenantId).toBe("https://company.atlassian.net");
    expect(validation.externalUserId).toBe(MYSELF.accountId);
    expect(validation.displayName).toBe(`Alice Example (${EMAIL})`);
    expect(validation.capabilities).toEqual([
      "identity.read",
      "issues.read",
      "comments.read",
      "attachments.read",
      "transitions.read",
      "projects.read",
      "fields.read",
    ]);
  });

  it("narrows the offered capabilities to the deployment switches", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher, {
      transitionsRead: false,
      fieldsRead: false,
      attachmentsRead: false,
    });
    const validation = await provider.validate({
      credential: credentialFor(provider),
    });
    expect(validation.capabilities).toEqual([
      "identity.read",
      "issues.read",
      "comments.read",
      "projects.read",
    ]);
  });

  it("refuses a Data Center deployment instead of pretending it is Cloud", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/myself")
        ? { json: MYSELF }
        : { json: { deploymentType: "Data Center", version: "9.12" } },
    );
    const provider = providerFor(fetcher);
    await expect(
      provider.validate({ credential: credentialFor(provider) }),
    ).rejects.toMatchObject({ code: "InvalidCredential" });
  });

  it("keeps the identity call as the answer when serverInfo is unavailable", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/myself")
        ? { json: MYSELF }
        : { status: 404, json: { errorMessages: ["no endpoint"] } },
    );
    const provider = providerFor(fetcher);
    await expect(
      provider.validate({ credential: credentialFor(provider) }),
    ).resolves.toMatchObject({ externalUserId: MYSELF.accountId });
  });

  it("fails closed when the site is no longer configured, without dialling", async () => {
    const { fetcher, calls } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    const credential = credentialFor(provider, SANDBOX.id);
    const narrowed = new JiraProvider(config({ sites: [COMPANY] }), fetcher);
    await expect(narrowed.validate({ credential })).rejects.toMatchObject({
      code: "CredentialRevoked",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a stored credential that is not a Jira credential", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    for (const raw of [
      "not json",
      JSON.stringify({ siteId: "company", email: EMAIL }),
      JSON.stringify({ siteId: "", email: EMAIL, token: TOKEN }),
    ]) {
      await expect(
        provider.validate({ credential: raw }),
      ).rejects.toMatchObject({ code: "CredentialRevoked" });
    }
  });
});
