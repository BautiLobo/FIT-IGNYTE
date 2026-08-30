// Service worker: solo maneja Web Push (mostrar la notificacion y abrir
// el panel al tocarla). No cachea nada -- no es para funcionar offline,
// es el requisito del navegador para poder recibir push en segundo plano.

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { /* payload no-JSON, usar defaults */ }

  const title = data.title || 'FIT IGNYTE';
  const body = data.body || 'You have a new notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
