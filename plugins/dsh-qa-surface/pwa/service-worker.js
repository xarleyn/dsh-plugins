/* global self */

// QA's HTML and authenticated traffic stay on the network. Only a failed
// navigation to the app entry receives this built-in, account-free response.
const appPath = new URL(self.registration.scope).pathname;
const offlinePage = `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Нет связи со стендом</title>
<style>
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 1rem/1.55 system-ui, sans-serif; }
main { max-width: 28rem; padding: 1.5rem; }
h1 { line-height: 1.2; }
a { display: inline-block; padding-block: .65rem; }
</style>
<main>
  <h1>Нет связи со стендом</h1>
  <p>Проверьте подключение к сети и попробуйте снова.</p>
  <a href="">Повторить подключение</a>
</main>
</html>`;

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    (url.pathname !== appPath && url.pathname !== `${appPath}/`)
  )
    return;

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(offlinePage, {
          status: 503,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
    ),
  );
});
