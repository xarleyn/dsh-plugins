import { randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  archiveHost,
  boundedBody,
  ticketPattern,
  type ArchiveOperation,
} from "./protocol.js";
import { sourceDenied } from "./turns.js";

interface Ticket {
  readonly operation: ArchiveOperation;
  readonly check: () => Promise<void>;
  used: boolean;
  authorized: boolean;
}

/** The reader only receives an opaque, single-use ticket. It must redeem it
 * against this Host immediately before touching its private filesystem. */
export class ArchiveGateway {
  private readonly tickets = new Map<string, Ticket>();
  private listener: Promise<void> | undefined;
  private readonly server: Server;
  constructor(
    private readonly readerPort: number,
    private readonly authPort: number,
    private readonly signingKey: KeyObject,
  ) {
    this.server = createServer(async (req, res) => {
      const key = req.url ?? "";
      const ticket = this.tickets.get(key);
      res.setHeader("Cache-Control", "no-store");
      const challenge = req.headers["x-reader-challenge"];
      if (
        typeof challenge !== "string" ||
        !/^[a-f0-9]{64}$/u.test(challenge) ||
        req.method !== "POST" ||
        !ticketPattern.test(key) ||
        !ticket ||
        ticket.used
      ) {
        res.writeHead(403).end();
        return;
      }
      ticket.used = true;
      try {
        await ticket.check();
        if (this.tickets.get(key) !== ticket) throw sourceDenied();
        const body = JSON.stringify(ticket.operation);
        const signature = sign(
          null,
          Buffer.from([challenge, key, body].join("\n")),
          this.signingKey,
        ).toString("base64");
        ticket.authorized = true;
        res
          .writeHead(200, {
            "Content-Type": "application/json",
            "X-Archive-Signature": signature,
          })
          .end(body);
      } catch {
        res.writeHead(403).end();
      }
    });
    this.server.requestTimeout = 10000;
  }

  private listen() {
    return (this.listener ??= new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        this.listener = undefined;
        reject(error);
      };
      this.server.once("error", failed);
      this.server.listen(this.authPort, archiveHost, () => {
        this.server.off("error", failed);
        this.server.unref();
        resolve();
      });
    }));
  }

  async perform(
    operation: ArchiveOperation,
    check: () => Promise<void>,
    signal: AbortSignal,
  ) {
    await check();
    await this.listen();
    signal.throwIfAborted();
    const key = "/" + randomBytes(32).toString("hex");
    const verify = async () => {
      signal.throwIfAborted();
      await check();
      signal.throwIfAborted();
    };
    const ticket: Ticket = {
      operation,
      check: verify,
      used: false,
      authorized: false,
    };
    this.tickets.set(key, ticket);
    try {
      const response = await fetch(
        "http://" + archiveHost + ":" + this.readerPort + key,
        {
          method: "POST",
          redirect: "error",
          signal,
        },
      );
      if (!response.ok || !ticket.authorized || !response.body) {
        await response.body?.cancel();
        throw new Error("Источник поиска недоступен.");
      }
      const result = JSON.parse(
        await boundedBody(response.body, 512 * 1024),
      ) as unknown;
      await verify();
      return result;
    } finally {
      this.tickets.delete(key);
    }
  }

  dispose() {
    this.tickets.clear();
    this.server.closeAllConnections();
    this.server.close();
  }
}
