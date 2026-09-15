import {
  Bitrix24Provider,
  parseBitrixWebhook,
} from "../src/providers/bitrix24.js";
import { resolveConfig } from "../src/config.js";

describe("Bitrix24 provider", () => {
  it("accepts only bounded HTTPS Bitrix webhook URLs", () => {
    const parsed = parseBitrixWebhook(
      "https://company.bitrix24.ru/rest/42/abcdefghijk/",
      [".bitrix24.ru"],
    );
    expect(parsed.portal).toBe("company.bitrix24.ru");
    expect(parsed.credential).toContain("abcdefghijk");
    for (const invalid of [
      "http://company.bitrix24.ru/rest/42/abcdefghijk",
      "https://company.bitrix24.ru:444/rest/42/abcdefghijk",
      "https://evil.example/rest/42/abcdefghijk",
      "https://bitrix24.ru/rest/42/abcdefghijk",
      "https://company.bitrix24.ru/rest/42/abcdefghijk?next=1",
      "https://company.bitrix24.ru/other/42/abcdefghijk",
    ]) {
      expect(() => parseBitrixWebhook(invalid, [".bitrix24.ru"])).toThrow(
        /webhook URL/u,
      );
    }
  });

  it("uses fixed read-only methods and does not put credentials in headers/body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          result: { ID: "7", NAME: "Иван", LAST_NAME: "Иванов" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new Bitrix24Provider(resolveConfig(), fetcher);
    const credential = JSON.stringify({
      webhookBaseUrl: "https://company.bitrix24.ru/rest/42/abcdefghijk",
    });
    await provider.validate({ credential });
    await provider.execute({ credential }, "crm.get", {
      entityTypeId: 2,
      id: 9,
    });
    expect(calls.map(({ url }) => url)).toEqual([
      "https://company.bitrix24.ru/rest/42/abcdefghijk/profile.json",
      "https://company.bitrix24.ru/rest/42/abcdefghijk/crm.item.get.json",
    ]);
    expect(
      JSON.stringify(calls.map(({ init }) => init?.headers)),
    ).not.toContain("abcdefghijk");
    expect(calls[1]?.init?.body).toBe('{"entityTypeId":2,"id":9}');
    await expect(
      provider.execute({ credential }, "raw_rest", {}),
    ).rejects.toThrow(/Unsupported/u);
  });
});
