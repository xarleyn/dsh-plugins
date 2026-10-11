import { describe, expect, it, vi } from "vitest";
import { createQaAccountUpload } from "../../src/client/account-upload.js";
describe("account upload carrier", () => {
  it("sends exact bytes as a Blob through the QA route with the current token", async () => {
    const post = vi.fn(
      async (request: {
        path: string;
        body: Blob;
        headers: Record<string, string>;
      }) => {
        expect(request.path).toBe(
          "api/qa-chat-upload?sessionId=chat-a&name=demo.txt",
        );
        expect(request.headers.authorization).toBe("Bearer synthetic-token");
        expect([...new Uint8Array(await request.body.arrayBuffer())]).toEqual([
          1, 2, 3,
        ]);
        return {
          status: 200,
          body: JSON.stringify({
            ok: true,
            value: { receiptId: "synthetic-receipt" },
          }),
        };
      },
    );
    const upload = createQaAccountUpload(
      () => ({ post }),
      () => "synthetic-token",
    );
    expect(
      (await upload.upload("chat-a", new Uint8Array([1, 2, 3]), "demo.txt")).ok,
    ).toBe(true);
  });
  it("withholds a completed receipt if the account changes during upload", async () => {
    let token = "first-token";
    const upload = createQaAccountUpload(
      () => ({
        post: async () => {
          token = "different-token";
          return { status: 200, body: "{}" };
        },
      }),
      () => token,
    );
    await expect(upload.upload("chat-a", new Uint8Array([1]))).rejects.toThrow(
      "refused",
    );
  });
});
