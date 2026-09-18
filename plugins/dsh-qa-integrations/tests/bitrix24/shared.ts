export const CREDENTIAL = JSON.stringify({
  webhookBaseUrl: "https://company.bitrix24.ru/rest/42/abcdefghijk",
});

export interface StubCall {
  readonly method: string;
  readonly body: Record<string, unknown>;
  readonly headers: unknown;
}

export function stub(bodies: Record<string, unknown> = {}) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = url.slice(url.lastIndexOf("/") + 1).replace(/\.json$/u, "");
    calls.push({
      method,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: init?.headers,
    });
    return new Response(JSON.stringify(bodies[method] ?? { result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

export const PROFILE = {
  result: { ID: "7", NAME: "Иван", LAST_NAME: "Иванов" },
};
