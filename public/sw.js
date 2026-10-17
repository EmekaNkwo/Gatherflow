/**
 * GatherFlow's service worker. It does one thing: show the daily reminder
 * when the server pushes it, even with no GatherFlow tab open, and open the
 * right page when the reminder is clicked. No caching, no offline mode.
 */
self.addEventListener("push", (event) => {
  let message = { title: "GatherFlow reminders", body: "You have follow-ups waiting.", url: "/follow-ups/my-tasks" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // A push without a readable payload still deserves the generic reminder.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: "gatherflow-daily-reminder",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever navigate within this site, whatever the payload said.
  const target = new URL(event.notification.data?.url ?? "/dashboard", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/dashboard`;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((client) => (client ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
