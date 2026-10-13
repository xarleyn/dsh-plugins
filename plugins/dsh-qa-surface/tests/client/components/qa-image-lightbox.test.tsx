// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../../src/client/components/Markdown.js";
import { QaMessage } from "../../../src/client/components/QaMessage.js";

/**
 * A transcript thumbnail is 132 px of the figure the question is about, and
 * the anchor it used to be is a click the browser answers with nothing: a
 * top-level navigation to a `blob:` address is refused. A click now raises the
 * same image over a mask.
 */
const ZOOM = "Открыть изображение в полном размере";

function attached() {
  return render(
    <QaMessage
      message={{
        id: "user:1",
        role: "user",
        text: "Что на фото?",
        status: "committed",
        images: [
          {
            attachmentId: "a1",
            mediaType: "image/png",
            previewUrl: "blob:preview",
          },
        ],
      }}
      renderMarkdown={false}
      showTimestamp={false}
    />,
  );
}

describe("image preview", () => {
  it("opens the attached image at full size on click", () => {
    attached();
    expect(screen.queryByTestId("qa-image-lightbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ZOOM }));
    expect(
      screen.getByTestId("qa-image-lightbox-image").getAttribute("src"),
    ).toBe("blob:preview");
  });

  it("ends on Escape, on the mask and on the close control", () => {
    attached();
    const trigger = screen.getByRole("button", { name: ZOOM });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("qa-image-lightbox")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("qa-image-lightbox"));
    expect(screen.queryByTestId("qa-image-lightbox")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("qa-image-lightbox-close"));
    expect(screen.queryByTestId("qa-image-lightbox")).toBeNull();
  });

  it("renders a markdown image as a zoomable one", () => {
    const { container } = render(
      <Markdown text="![схема](https://example.com/a.png)" />,
    );
    fireEvent.click(within(container).getByRole("button", { name: ZOOM }));
    expect(
      screen.getByTestId("qa-image-lightbox-image").getAttribute("src"),
    ).toBe("https://example.com/a.png");
  });

  it("leaves an image inside a link without its own activation", () => {
    const { container } = render(
      <Markdown text="[![схема](https://example.com/a.png)](https://example.com)" />,
    );
    expect(container.querySelector("a button")).toBeNull();
    expect(
      within(container).getByTestId("qa-md-image").getAttribute("src"),
    ).toBe("https://example.com/a.png");
  });
});
