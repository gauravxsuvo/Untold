/* Notifications only. No fetch handler, offline cache, or stored message contents. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data?.json() ?? {};
      } catch {
        /* Show a private generic alert. */
      }
      if (!data || typeof data !== "object") data = {};
      const idPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const conversationId =
        typeof data.conversationId === "string" && idPattern.test(data.conversationId)
          ? data.conversationId
          : null;
      // Always display a visible notification for Web Push, including on iOS.
      await self.registration.showNotification("Untold", {
        body: "You have a new message. Open Untold to read it.",
        icon: "/icons/untold-192.png?v=2",
        badge: "/icons/untold-192.png?v=2",
        tag: conversationId ? `untold-${conversationId}` : "untold-new-message",
        data: {
          path: conversationId
            ? `/app/conversations?conversation=${encodeURIComponent(conversationId)}`
            : "/app/inbox",
        },
      });
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows)
        client.postMessage({ type: "untold-message-available", conversationId });
      // Receiving ciphertext acknowledges delivery, never reading. Session and membership
      // are checked by both endpoints; a stale subscription cannot acknowledge another account.
      if (typeof data.viewerId !== "string") return;
      try {
        const response = await fetch("/api/delivery", {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return;
        const snapshot = await response.json();
        if (snapshot.viewerId !== data.viewerId || !Array.isArray(snapshot.messages)) return;
        const ids = snapshot.messages
          .filter(
            (message) =>
              typeof message.id === "string" &&
              idPattern.test(message.id) &&
              typeof message.envelope === "string" &&
              message.envelope.length > 0,
          )
          .map((message) => message.id)
          .slice(0, 100);
        if (ids.length)
          await fetch("/api/delivery", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewerId: data.viewerId, messageIds: ids }),
          });
      } catch {
        /* Foreground delivery retries on reconnect. */
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const value = event.notification.data?.path;
      const path =
        typeof value === "string" &&
        /^\/app\/(?:inbox|conversations\?conversation=[0-9a-f-]{36})$/.test(value)
          ? value
          : "/app/inbox";
      const target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
      if (client) {
        await client.navigate(target);
        await client.focus();
      } else await self.clients.openWindow(target);
    })(),
  );
});
