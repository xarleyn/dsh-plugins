import { resolveManagedServiceCredentials } from "../src/service-credentials/config.js";
import { ServiceCredentialRegistry } from "../src/service-credentials/registry.js";
import { ACME_PROFILE, PROFILE_INPUT } from "./service-credentials.helpers.js";
describe("managed service credentials: configuration", () => {
  it("refuses a profile without a resource boundary", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: PROFILE_INPUT({ resources: {} }).profiles,
      }),
    ).toThrow(/resource boundary/u);
  });

  it("refuses an administrator policy that tries to widen the ceiling", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: PROFILE_INPUT({ policy: { "records.write": "allow" } })
          .profiles,
      }),
    ).toThrow(/can only be narrowed/u);
  });

  it("refuses a profile that names both a secret file and an environment variable", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: [
          {
            ...PROFILE_INPUT().profiles[0],
            credential: {
              secretFile: "/run/secrets/x",
              secretEnv: "ACME_SERVICE_TOKEN",
            },
          },
        ],
      }),
    ).toThrow(/not both/u);
  });

  it("refuses duplicate profile ids and duplicate instances", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: [ACME_PROFILE, ACME_PROFILE],
      }),
    ).toThrow(/duplicate/u);
  });

  it("names the profile when its instance is unknown to the deployment", () => {
    expect(
      () =>
        new ServiceCredentialRegistry(
          resolveManagedServiceCredentials({
            profiles: [{ ...PROFILE_INPUT().profiles[0], instance: "typo" }],
          }),
          () => undefined,
        ),
    ).toThrow(/acme-readonly names unknown acme instance/u);
  });
});
