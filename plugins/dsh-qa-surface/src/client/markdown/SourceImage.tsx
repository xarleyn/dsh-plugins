import { useEffect, useRef, useState } from "react";
import { QaZoomImage } from "../components/QaZoomImage.js";
import { safeHref } from "./source-chip.js";

/** Illustrations are fetched on approach to the viewport, never in a document-wide burst. */
export function SourceImage({
  src,
  alt,
  load,
}: {
  readonly src: string;
  readonly alt: string;
  readonly load: (path: string) => Promise<string | undefined>;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const remote = safeHref(src)?.startsWith("http") === true ? src : undefined;
  const [url, setUrl] = useState<string | undefined>(remote);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let started = false;
    setUrl(remote);
    setFailed(false);
    if (remote !== undefined) return;
    const start = (): void => {
      if (started) return;
      started = true;
      void load(src).then(
        (value) => {
          if (!alive) return;
          setUrl(value);
          setFailed(value === undefined);
        },
        () => alive && setFailed(true),
      );
    };
    const node = root.current;
    if (typeof IntersectionObserver === "undefined" || node === null) start();
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer?.disconnect();
                start();
              }
            },
            { rootMargin: "200px" },
          );
    if (node !== null) observer?.observe(node);
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [src, remote, load]);
  return (
    <span
      ref={root}
      className="dsh-qa-source-image"
      data-testid="qa-source-image"
    >
      {url === undefined ? (
        <span data-testid="qa-source-image-placeholder">
          {alt || "Иллюстрация"}
          {failed ? " — изображение недоступно" : " — загрузка изображения…"}
        </span>
      ) : (
        <QaZoomImage
          className="dsh-qa-md-image"
          testId="qa-source-image-loaded"
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setUrl(undefined);
            setFailed(true);
          }}
        />
      )}
    </span>
  );
}
