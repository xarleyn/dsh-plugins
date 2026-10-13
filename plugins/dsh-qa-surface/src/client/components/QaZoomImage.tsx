import { useCallback, useEffect, useRef, useState } from "react";
import type { ImgHTMLAttributes } from "react";
import { joinQaDialogStack } from "./QaModal.js";

const ZOOM_LABEL = "Открыть изображение в полном размере";

/**
 * A surface image at its reading size, plus the overlay it opens into.
 *
 * A transcript thumbnail is 132 px wide: enough to recognise a figure, not
 * enough to read one. The thumbnail used to be an anchor to its own `blob:`
 * address, and a browser that refuses top-level navigation to a blob answers
 * the click with nothing at all, so the reader had no way to see the image the
 * question was about.
 */
export function QaZoomImage({
  src,
  alt,
  className,
  testId,
  openLabel = ZOOM_LABEL,
  zoomable = true,
  ...image
}: {
  readonly src: string;
  readonly alt: string;
  readonly className: string;
  readonly testId: string;
  readonly openLabel?: string;
  /**
   * Whether the image answers a click. An image that sits inside a link does
   * not: a control nested in an anchor is invalid, and the activation the
   * reader meant for the link would reach the zoom as well.
   */
  readonly zoomable?: boolean;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "className">) {
  const [zoomed, setZoomed] = useState(false);
  const close = useCallback(() => setZoomed(false), []);
  if (!zoomable)
    return (
      <img
        {...image}
        className={className}
        data-testid={testId}
        src={src}
        alt={alt}
      />
    );
  return (
    <>
      <button
        type="button"
        className="dsh-qa-zoom"
        aria-label={openLabel}
        title={openLabel}
        onClick={() => setZoomed(true)}
      >
        <img
          {...image}
          className={className}
          data-testid={testId}
          src={src}
          alt={alt}
        />
      </button>
      {zoomed ? <QaImageLightbox src={src} alt={alt} onClose={close} /> : null}
    </>
  );
}

/**
 * The overlay itself: the image contained to the viewport over a mask. Escape,
 * the mask and the close control end it, and the close control takes focus on
 * open so a keyboard reader leaves the same way it entered.
 *
 * The root is a span because an answer's image sits inside its paragraph, and
 * a block-level root there is invalid nesting the browser repairs by lifting it
 * out of the text that owns it.
 */
export function QaImageLightbox({
  src,
  alt,
  onClose,
}: {
  readonly src: string;
  readonly alt: string;
  readonly onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = joinQaDialogStack();
    const opener = document.activeElement;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!dialog.innermost()) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      dialog.leave();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);
  return (
    <span
      className="dsh-qa-lightbox"
      data-testid="qa-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt === "" ? "Изображение" : alt}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <img
        className="dsh-qa-lightbox__image"
        data-testid="qa-image-lightbox-image"
        src={src}
        alt={alt}
      />
      <button
        ref={closeButton}
        type="button"
        className="dsh-qa-lightbox__close"
        data-testid="qa-image-lightbox-close"
        aria-label="Закрыть просмотр изображения"
        onClick={onClose}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m3.5 3.5 7 7m0-7-7 7" />
        </svg>
      </button>
    </span>
  );
}
