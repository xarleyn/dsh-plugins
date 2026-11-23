/* global document, window, navigator, MutationObserver, URLSearchParams */

(() => {
  const script = document.currentScript;
  if (
    !script ||
    !window.isSecureContext ||
    window.top !== window ||
    document.head.hasAttribute("data-dsh-qa-pwa")
  )
    return;

  const assets = new URL("./", script.src);
  const appPath = assets.pathname.slice(0, -"/_pwa/".length);
  document.head.setAttribute("data-dsh-qa-pwa", "");

  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = new URL("manifest.webmanifest", assets).href;
  const appleIcon = document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  appleIcon.href = new URL("apple-touch-icon.png", assets).href;

  const standalone = window.matchMedia("(display-mode: standalone)");
  const appleMobile =
    /iPhone|iPad|iPod/u.test(navigator.userAgent) ||
    (/Macintosh/u.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const macSafari =
    /Macintosh/u.test(navigator.userAgent) &&
    navigator.vendor === "Apple Computer, Inc.";
  const manualHelp = appleMobile
    ? "В Safari нажмите «Поделиться» → «На экран Домой». Если появится «Открывать как веб‑приложение», включите этот переключатель."
    : "В Safari откройте меню «Файл» → «Добавить в Dock».";

  const install = document.createElement("div");
  install.setAttribute("data-dsh-qa-pwa-install", "");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Установить приложение";
  button.style.minHeight = "44px";
  const help = document.createElement("p");
  help.id = "dsh-qa-pwa-help";
  help.className = "dsh-qa-auth__lead";
  help.hidden = true;
  help.textContent = manualHelp;
  install.append(button, help);

  let nativePrompt;
  let installed = false;
  let workerRequested = false;
  let framePending = false;

  function matchesApp(path) {
    return path === appPath || path.startsWith(`${appPath}/`);
  }

  function updateMetadata() {
    const { pathname, search } = window.location;
    // The overlay serves the Host index first, then restores the QA URL.
    const redirectedPath = new URLSearchParams(search)
      .get("__dsh_qa_route")
      ?.split(/[?#]/u, 1)[0];
    if (
      matchesApp(pathname) ||
      (pathname === "/" && redirectedPath && matchesApp(redirectedPath))
    ) {
      if (!manifest.isConnected) document.head.prepend(manifest, appleIcon);
    } else {
      manifest.remove();
      appleIcon.remove();
      nativePrompt = undefined;
    }
  }

  function reconcile() {
    updateMetadata();
    if (
      document.body?.dataset.dshQaSurface !== "active" ||
      !matchesApp(window.location.pathname)
    ) {
      install.remove();
      return;
    }
    if (!workerRequested && "serviceWorker" in navigator) {
      workerRequested = true;
      void navigator.serviceWorker
        .register(new URL("service-worker.js", assets), {
          scope: appPath,
          updateViaCache: "none",
        })
        .catch(() => {
          // Installation metadata still works in browsers that block workers.
        });
    }

    if (
      installed ||
      standalone.matches ||
      navigator.standalone ||
      (!nativePrompt && !appleMobile && !macSafari)
    ) {
      install.remove();
      return;
    }
    const seat = document.querySelector(
      ".dsh-qa-auth__card, .dsh-qa-sidebar__footer",
    );
    if (seat && install.parentElement !== seat) {
      button.className = seat.matches(".dsh-qa-auth__card")
        ? "dsh-qa-auth__link"
        : "dsh-qa-footer__guide";
      seat.append(install);
    }
    if (nativePrompt) {
      help.hidden = true;
      button.removeAttribute("aria-expanded");
      button.removeAttribute("aria-controls");
    } else {
      button.setAttribute("aria-expanded", String(!help.hidden));
      button.setAttribute("aria-controls", help.id);
    }
  }

  function scheduleReconcile() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(() => {
      framePending = false;
      reconcile();
    });
  }

  button.addEventListener("click", async () => {
    if (nativePrompt) {
      const prompt = nativePrompt;
      nativePrompt = undefined;
      button.disabled = true;
      try {
        await prompt.prompt();
      } catch {
        // The browser may revoke the deferred prompt between show and click.
      } finally {
        button.disabled = false;
        reconcile();
      }
      return;
    }
    help.hidden = !help.hidden;
    button.setAttribute("aria-expanded", String(!help.hidden));
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!manifest.isConnected) return;
    event.preventDefault();
    nativePrompt = event;
    scheduleReconcile();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    nativePrompt = undefined;
    scheduleReconcile();
  });
  standalone.addEventListener("change", scheduleReconcile);
  window.addEventListener("popstate", scheduleReconcile);
  updateMetadata();

  const watchSurface = () => {
    const observer = new MutationObserver(scheduleReconcile);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-dsh-qa-surface"],
    });
    reconcile();
  };
  if (document.body) watchSurface();
  else
    document.addEventListener("DOMContentLoaded", watchSurface, { once: true });
})();
