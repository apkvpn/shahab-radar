/* Shahab Radar – service worker (push + notification click). No caching, no secrets. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function fmtPrice(p) {
  const a = Math.abs(p);
  let min = 2;
  let max = 2;
  if (a < 1000 && a >= 1) max = 4;
  else if (a < 1 && a >= 0.01) { min = 4; max = 5; }
  else if (a < 0.01 && a >= 0.0001) { min = 6; max = 6; }
  else if (a < 0.0001) { min = 8; max = 8; }
  return "$" + Number(p).toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
}

function hhmm(ms) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = {};
  }
  let title = "Shahab Radar - سیگنال ترید";
  let body = "";
  let tag = "shahab-radar";
  if (d.type === "signal") {
    // Shahab Radar / LONG — BTC / $86,060.31 / 15m / 04:30 (time in the device's own timezone)
    body = "LONG — " + d.symbol + "\n" + fmtPrice(d.price) + "\n" + d.timeframe + "\n" + hhmm(d.signalTime);
    tag = d.id;
  } else {
    title = d.title || title;
    body = d.body || "";
    tag = "shahab-test";
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: tag, // same tag as the in-page notification => never shown twice
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: d.url || "/", id: d.id || null },
      renotify: true,
      dir: "rtl",
      lang: "fa",
      timestamp: d.signalTime || Date.now(),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/";
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
          await c.focus();
          if (data.id) c.postMessage({ type: "open-signal", id: data.id });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
