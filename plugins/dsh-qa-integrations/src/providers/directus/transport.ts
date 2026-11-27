import { get } from "node:https";
import { Readable } from "node:stream";

/** Directus always verifies TLS, even on a Host with a relaxed default. */
export const fetchDirectus: typeof fetch = (input, init) =>
  new Promise((resolve, reject) => {
    const address = new URL(String(input));
    const signal = init?.signal;
    const request = get(
      address,
      {
        rejectUnauthorized: true,
        headers: Object.fromEntries(new Headers(init?.headers)),
        ...(signal == null ? {} : { signal }),
      },
      (upstream) => {
        try {
          const status = upstream.statusCode ?? 500;
          const headers = new Headers();
          for (const [name, value] of Object.entries(upstream.headers)) {
            for (const entry of Array.isArray(value) ? value : [value ?? ""]) {
              headers.append(name, entry);
            }
          }
          if (status === 204 || status === 205 || status === 304) {
            upstream.resume();
            resolve(new Response(null, { status, headers }));
            return;
          }
          const stream = Readable.toWeb(upstream) as ReadableStream<Uint8Array>;
          resolve(new Response(stream, { status, headers }));
        } catch (error) {
          upstream.destroy();
          reject(error);
        }
      },
    );
    request.on("error", reject);
  });
