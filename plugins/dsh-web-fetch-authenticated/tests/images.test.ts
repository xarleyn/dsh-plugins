import { describe, expect, it } from "vitest";

import {
  IMAGE_MEDIA_TYPES,
  fileNameFromUrl,
  imageAcceptHeader,
  imageNameFromUrl,
  sniffImageMediaType,
} from "../src/images.js";

/** A minimal PNG signature plus filler; the store's decode is not this unit's job. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

describe("image formats", () => {
  it("accepts exactly the raster set the attachment store holds", () => {
    expect(IMAGE_MEDIA_TYPES).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
    expect(imageAcceptHeader()).toBe(
      "image/png,image/jpeg,image/webp,image/gif",
    );
  });

  it("identifies a format from the file signature, not the server header", () => {
    expect(sniffImageMediaType(PNG_BYTES)).toBe("image/png");
    expect(
      sniffImageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])),
    ).toBe("image/jpeg");
    expect(sniffImageMediaType(new TextEncoder().encode("GIF89a...."))).toBe(
      "image/gif",
    );
    expect(
      sniffImageMediaType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      ),
    ).toBe("image/webp");
    expect(
      sniffImageMediaType(new TextEncoder().encode("<!doctype html>")),
    ).toBe(undefined);
    expect(sniffImageMediaType(new Uint8Array(0))).toBe(undefined);
  });

  it("derives a flat display name from an attachment URL", () => {
    // Attachment names arrive percent-encoded, braces and spaces included.
    expect(
      imageNameFromUrl(
        "https://jira.example.corp/secure/attachment/42/%7Bdemo%7D%20shot.png",
      ),
    ).toBe("{demo} shot.png");
    expect(imageNameFromUrl("https://example.test/a/b/screen%20shot.png")).toBe(
      "screen shot.png",
    );
    expect(imageNameFromUrl("https://example.test/")).toBe("image");
    expect(imageNameFromUrl("not a url")).toBe("image");
  });

  it("flattens a download name to a leaf the attachment store can keep", () => {
    // A file attachment arrives under whatever name the tracker's URL carries.
    // The store keeps a leaf, so a percent-encoded path has to lose its
    // separators here rather than reach the store with them.
    expect(
      fileNameFromUrl(
        "https://jira.example.corp/secure/attachment/42/report%20%231.pdf",
      ),
    ).toBe("report #1.pdf");
    expect(
      fileNameFromUrl("https://example.test/a/b/%2E%2E%2Fetc%2Fpasswd"),
    ).toBe("..-etc-passwd");
    expect(fileNameFromUrl("https://example.test/")).toBe("download");
    expect(fileNameFromUrl("not a url")).toBe("download");
  });
});
