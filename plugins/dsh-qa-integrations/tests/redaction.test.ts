import { redactSecrets } from "../src/redaction.js";

describe("redaction", () => {
  it("removes nested secret fields, bearer values and webhook paths", () => {
    const redacted = JSON.stringify(
      redactSecrets({
        access_token: "alpha",
        nested: {
          Authorization: "Bearer beta.gamma",
          url: "https://company.bitrix24.ru/rest/42/abcdefghijk/profile.json",
        },
      }),
    );
    expect(redacted).not.toContain("alpha");
    expect(redacted).not.toContain("beta.gamma");
    expect(redacted).not.toContain("abcdefghijk");
    expect(redacted).toContain("[REDACTED]");
  });
});
