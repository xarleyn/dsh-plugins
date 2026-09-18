import { IntegrationError } from "../src/errors.js";
import { GitlabProvider } from "../src/providers/gitlab/index.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import { UNCLASSIFIED_OPERATION } from "../src/service-credentials/types.js";
import {
  config,
  credential,
  profile,
  serviceContext,
  stub,
} from "./gitlab-service.helpers.js";

describe("GitLab managed service credentials", () => {
  it("classifies the job log as sensitive and refuses it through a service token", async () => {
    const { fetcher, calls } = stub(() => ({ json: [] }));
    const { provider, plaintext } = credential(fetcher);
    const metadata = provider.operationMetadata?.("jobs.log");
    expect(metadata).toMatchObject({
      effect: "read",
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    const decision = evaluateServiceOperation({
      metadata: metadata ?? UNCLASSIFIED_OPERATION,
      capability: "ci.logs.read",
      profile: profile(),
      boundaryKind: provider.resourceBoundaryKind?.("jobs.log"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "SensitiveReadRequiresPersonalCredential",
    });

    // Defence in depth: the provider refuses on its own classification, so a
    // caller that reached it without the broker's decision — or a future broker
    // bug — still does not download a job trace through a shared credential.
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "jobs.log",
        { project: "1208", jobId: 1 },
      ),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    expect(calls).toEqual([]);
  });

  it("keeps CI metadata service-safe", async () => {
    const { fetcher } = stub(() => ({ json: { id: 7 } }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "jobs.get",
        {
          project: "1208",
          jobId: 7,
        },
      ),
    ).resolves.toMatchObject({ id: 7 });
  });

  it("refuses a project outside the administrator boundary", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        {
          project: "9999",
        },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // The refusal happens before anything is sent upstream.
    expect(calls).toEqual([]);
  });

  it("serves an allowed project, addressed by id or by path under a listed group", async () => {
    const { fetcher, calls } = stub(() => ({ json: { id: 1208 } }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        {
          project: "1208",
        },
      ),
    ).resolves.toBeDefined();
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        {
          project: "group/platform/api",
        },
      ),
    ).resolves.toBeDefined();
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/v4/projects/1208",
      "/api/v4/projects/group%2Fplatform%2Fapi",
    ]);
  });

  it("lists only the projects the boundary names", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.includes("/groups/")
        ? { json: [{ id: 5, path_with_namespace: "group/platform/web" }] }
        : url.pathname.endsWith("/1208")
          ? { json: { id: 1208, path_with_namespace: "group/product" } }
          : { json: { id: 1337, path_with_namespace: "group/product/api" } },
    );
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "projects.list",
      {},
    )) as { serviceScoped: boolean; items: readonly { id: number }[] };
    // The listing is built from the allowlist, not from what the shared account
    // could reach: one fetch per listed project and one per listed group.
    expect(answer.serviceScoped).toBe(true);
    expect(answer.items.map((item) => item.id)).toEqual([1208, 1337, 5]);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/v4/projects/1208",
      "/api/v4/projects/group%2Fproduct",
      "/api/v4/groups/group%2Fplatform/projects",
    ]);
  });

  it("drops a project shared into a listed group from outside the boundary", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.includes("/groups/")
        ? {
            json: [
              { id: 5, path_with_namespace: "group/platform/web" },
              // GitLab shares projects into a group by default; this one lives
              // under another group entirely.
              { id: 9, path_with_namespace: "group/other/borrowed" },
            ],
          }
        : url.pathname.endsWith("/1208")
          ? { json: { id: 1208, path_with_namespace: "group/product" } }
          : { json: { id: 1337, path_with_namespace: "group/product/api" } },
    );
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "projects.list",
      {},
    )) as { items: readonly { id: number }[] };
    expect(answer.items.map((item) => item.id)).toEqual([1208, 1337, 5]);
    // The request also asks GitLab not to include shared projects at all.
    expect(calls[2]?.searchParams.get("with_shared")).toBe("false");
  });

  it("filters confidential issues out of a search, and refuses a note search", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.includes("/search")
        ? {
            json: [
              { id: 1, iid: 1, title: "visible", confidential: false },
              { id: 2, iid: 2, title: "secret", confidential: true },
            ],
          }
        : { json: {} },
    );
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "search.run",
      { scope: "issues", query: "term", project: "1208" },
    )) as { items: readonly { iid: number }[] };
    // The confidential flag is projected away, so the check has to happen on the
    // raw hits — which is exactly what it does.
    expect(answer.items.map((item) => item.iid)).toEqual([1]);

    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "search.run",
        {
          scope: "notes",
          query: "term",
          project: "1208",
        },
      ),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    expect(calls).toHaveLength(1);
  });

  it("reports a bounded project the service token cannot see instead of hiding it", async () => {
    const { fetcher } = stub((url) =>
      url.pathname === "/api/v4/projects/1208"
        ? { status: 404, json: { message: "404 Not Found" } }
        : { json: { id: 5 } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext({ projects: ["1208"] }) },
        "projects.list",
        {},
      ),
    ).resolves.toMatchObject({ unavailableResources: ["1208"] });
  });

  it("fails closed on a confidential issue instead of returning its content", async () => {
    const { fetcher } = stub(() => ({
      json: { iid: 4, confidentiality: true, confidential: true },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.get",
        {
          project: "1208",
          iid: 4,
        },
      ),
    ).rejects.toMatchObject({ code: "ResourceNotFound" });
  });

  it("drops confidential issues from a listing", async () => {
    const { fetcher } = stub(() => ({
      json: [
        { iid: 1, title: "open", confidential: false },
        { iid: 2, title: "secret", confidential: true },
      ],
    }));
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "issues.list",
      { project: "1208" },
    )) as { items: readonly { iid: number }[] };
    expect(answer.items.map((item) => item.iid)).toEqual([1]);
  });

  it("requires a project for a listing, so a service call is never global", async () => {
    const { fetcher, calls } = stub(() => ({ json: [] }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "mergeRequests.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.list",
        {
          project: "1208",
        },
      ),
    ).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("leaves the personal mode untouched", async () => {
    const { fetcher } = stub(() => ({ json: { id: 42 } }));
    const { provider, plaintext } = credential(fetcher);
    // No boundary, no service mode: the call is the plain read it always was,
    // including for a project the deployment's allowlist does not name.
    await expect(
      provider.execute({ credential: plaintext }, "jobs.log", {
        project: "9999",
        jobId: 3,
      }),
    ).resolves.toBeDefined();
    await expect(
      provider.execute({ credential: plaintext }, "projects.get", {
        project: "9999",
      }),
    ).resolves.toMatchObject({ id: 42 });
  });

  it("fails closed when service mode arrives without a boundary", async () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, credentialSource: "service" },
        "projects.get",
        { project: "1208" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
  });

  it("reports a token that reaches beyond read-only as unsafe_scope", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/user")
        ? { json: { id: 153, username: "qa-service", name: "QA Service" } }
        : { json: { scopes: ["api", "read_repository"] } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({
      status: "unsafe_scope",
      grantedScopes: ["api", "read_repository"],
      upstreamIdentity: { id: "153", label: "QA Service (@qa-service)" },
    });
  });

  it("reports a read-only token as healthy without exercising it", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.endsWith("/user")
        ? { json: { id: 153, username: "qa-service", name: "QA Service" } }
        : { json: { scopes: ["read_api"] } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({
      status: "healthy",
      grantedScopes: ["read_api"],
    });
    // Both endpoints are reads: a probe that changed upstream state would be a
    // write performed by a read-only credential.
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/v4/user",
      "/api/v4/personal_access_tokens/self",
    ]);
  });

  it("maps a rejected service token onto its health status", async () => {
    const { fetcher } = stub(() => ({
      status: 401,
      json: { message: "401 Unauthorized" },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("rejects a malformed service secret instead of spending it", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new GitlabProvider(config(), fetcher);
    expect(() =>
      provider.parseCredential("not a token", { instanceId: "corp" }),
    ).toThrow(IntegrationError);
  });
});
