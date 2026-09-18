import {
  sameOriginUrl,
  translationRef,
  unitState,
} from "../../src/providers/weblate/operations.js";
import { resultsOf } from "../../src/providers/weblate/transport.js";
import {
  INSTANCE,
  TOKEN,
  UNIT,
  credentialFor,
  provider,
  stub,
} from "./shared.js";

describe("weblate upstream URLs", () => {
  it("keeps an address only when it is the instance's own", () => {
    expect(sameOriginUrl(`${INSTANCE}/api/units/1/`, INSTANCE)).toBe(
      `${INSTANCE}/api/units/1/`,
    );
    expect(
      sameOriginUrl("https://evil.example.com/api/units/1/", INSTANCE),
    ).toBeUndefined();
    expect(sameOriginUrl("javascript:alert(1)", INSTANCE)).toBeUndefined();
    expect(sameOriginUrl(42, INSTANCE)).toBeUndefined();
  });

  it("reads the unit reference out of a nested URL, category and all", () => {
    expect(
      translationRef(
        `${INSTANCE}/api/translations/app/android/auth/de/`,
        INSTANCE,
      ),
    ).toEqual({ project: "app", component: "android/auth", language: "de" });
    expect(
      translationRef(
        "https://evil.example.com/api/translations/a/b/c/",
        INSTANCE,
      ),
    ).toBeUndefined();
    expect(
      translationRef(`${INSTANCE}/api/translations/app/`, INSTANCE),
    ).toBeUndefined();
  });

  it("drops a next link that leaves the instance instead of following it", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 40,
        next: "https://evil.example.com/api/projects/?page=2",
        previous: null,
        results: [],
      },
    }));
    const p = provider(fetcher);
    const answer = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "projects.list",
      {},
    )) as Record<string, unknown>;
    expect(answer["pagination"]).toEqual({ page: 1, perPage: 20, total: 40 });
    expect(calls).toHaveLength(1);
  });

  it("never echoes an address from another origin", async () => {
    const { fetcher } = stub(() => ({
      json: {
        ...UNIT,
        web_url: "https://evil.example.com/steal",
        translation:
          "https://evil.example.com/api/translations/app/frontend/de/",
      },
    }));
    const p = provider(fetcher);
    const unit = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "units.get",
      { unitId: 1 },
    )) as Record<string, unknown>;
    expect(unit["webUrl"]).toBeUndefined();
    // The reference is read from the same URL, so it is dropped with it.
    expect(unit["project"]).toBeUndefined();
    expect(unit["component"]).toBeUndefined();
  });

  it("maps Weblate's own state numbers and nothing more", () => {
    expect(unitState(0)).toBe("untranslated");
    expect(unitState(10)).toBe("needs-editing");
    expect(unitState(20)).toBe("translated");
    expect(unitState(30)).toBe("approved");
    expect(unitState(100)).toBe("read-only");
    expect(unitState(55)).toBe("unknown");
    expect(unitState("20")).toBe("unknown");
  });

  it("unwraps a paginated answer and tolerates one that is not", () => {
    expect(resultsOf({ results: [1, 2] })).toEqual([1, 2]);
    expect(resultsOf([1])).toEqual([1]);
    expect(resultsOf({ data: [] })).toEqual([]);
    expect(resultsOf(null)).toEqual([]);
  });
});
