import { redactSecrets } from "../src/redaction.js";

describe("redaction", () => {
  it("removes nested secret fields, bearer values and webhook paths", () => {
    const redacted = JSON.stringify(
      redactSecrets({
        access_token: "alpha",
        nested: {
          Authorization: "Bearer beta.gamma",
          url: "https://company.bitrix24.ru/rest/42/abcdefghijk/profile.json",
          private_token: "delta",
          trace: "deploy --token glpat-abcdefghij0123456789",
        },
      }),
    );
    expect(redacted).not.toContain("alpha");
    expect(redacted).not.toContain("beta.gamma");
    expect(redacted).not.toContain("abcdefghijk");
    expect(redacted).not.toContain("delta");
    expect(redacted).not.toContain("glpat-abcdefghij0123456789");
    expect(redacted).toContain("[REDACTED]");
  });

  it("catches the secrets a build log prints as a plain string", () => {
    // Log and artifact text arrives as one string, so a field-name rule cannot
    // see it; the printed key/value shapes are what a CI job actually leaves.
    const line = [
      "deploy --token abcdefghijklmnopqrstuvwxyz012345",
      "password=hunter2",
      "api_key: 9d8f7a6b5c",
      "Authorization: Bearer eyJhbGciOi.eyJzdWIi.SflKxwRJ",
    ].join("\n");
    const redacted = String(redactSecrets(line));
    for (const secret of [
      "abcdefghijklmnopqrstuvwxyz012345",
      "hunter2",
      "9d8f7a6b5c",
      "eyJhbGciOi.eyJzdWIi.SflKxwRJ",
    ]) {
      expect(redacted).not.toContain(secret);
    }
    // The names stay, so a log still reads as a log.
    expect(redacted).toContain("password=[REDACTED]");
    expect(redacted).toContain("deploy --token [REDACTED]");
  });
});
