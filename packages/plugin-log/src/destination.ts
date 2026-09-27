/**
 * The file destination's lifecycle: the stream shape a pino destination is
 * given, the text-transcoding wrapper that sits in front of it, the discard
 * stream that stands in when file output is off, and the two ways a logger stops
 * writing (quietly on rollover, awaited on close). Every path here is
 * fail-open — a destination that cannot be closed must never surface.
 */

import { Writable } from "node:stream";
import type { DestinationStream } from "pino";
import { renderTextRecord } from "./format.js";

export type ClosableDestination = DestinationStream & {
  destroyed?: boolean;
  once?: (event: string, listener: () => void) => unknown;
  end?: () => unknown;
  flushSync?: () => void;
};

/** Converts pino NDJSON chunks to readable lines before the file destination. */
export class TextDestination extends Writable {
  private buffered = "";

  constructor(private readonly target: ClosableDestination) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      this.buffered += chunk.toString();
      this.writeCompleteLines();
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    try {
      if (this.buffered.length > 0) {
        this.target.write(renderTextRecord(this.buffered));
        this.buffered = "";
      }
      if (this.target.destroyed === true) {
        callback();
        return;
      }
      if (this.target.once !== undefined) {
        this.target.once("close", callback);
        this.target.end?.();
      } else {
        this.target.end?.();
        callback();
      }
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  flushSync(): void {
    this.writeCompleteLines();
    this.target.flushSync?.();
  }

  private writeCompleteLines(): void {
    let newline = this.buffered.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      if (line.length > 0) this.target.write(renderTextRecord(line));
      newline = this.buffered.indexOf("\n");
    }
  }
}

let sharedDevNull: Writable | undefined;
export function devNull(): Writable {
  sharedDevNull ??= new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return sharedDevNull;
}

export function closeQuietly(destination: ClosableDestination): void {
  try {
    destination.end?.();
  } catch {
    // Fail-open: closing must never surface.
  }
}

/**
 * SonicBoom's `end()` takes no callback — completion is signaled by the
 * `close` event. A bounded guard keeps a wedged stream from hanging plugin
 * disposal forever.
 */
export function closeDestination(
  destination: ClosableDestination,
): Promise<void> {
  return new Promise((resolve) => {
    if (destination.destroyed === true) {
      resolve();
      return;
    }
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve();
    };
    const guard = setTimeout(done, 1000);
    guard.unref();
    try {
      destination.once?.("close", done);
      destination.end?.();
    } catch {
      done();
    }
  });
}
