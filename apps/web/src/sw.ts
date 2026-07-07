/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST as never);
void self.skipWaiting();
clientsClaim();

self.addEventListener("push", (event) => {
  const data = event.data?.json() || { title: "Уведомление", body: "Есть новое событие" };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      data: data.payload || {}
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
