/* Service worker. Its only job is push notifications — this is deliberately
 * NOT an offline/caching worker, because a stale cached build of an
 * accounting app is worse than no cache at all.
 *
 * Added 5 Sep 2026: the Mini Barn Market kiosk charges customers for items
 * the catalog doesn't know, at a price they say out loud. That needs a human
 * to look at it, and "there's a number on a page you might open tomorrow"
 * isn't good enough.
 */

self.addEventListener('install', () => {
  // Take over straight away rather than waiting for every tab to close -
  // otherwise the first subscribe happens against a worker that never
  // activates, and nothing arrives until the next full restart.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // A payload we can't parse still deserves to ring - something happened.
    data = { title: 'Farmgirl Finance', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Farmgirl Finance'
  const options = {
    body: data.body || '',
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    data: { url: data.url || '/entities' },
    // Same tag replaces rather than stacks, so ten unlisted items in one
    // afternoon is one standing notification instead of ten to dismiss.
    tag: data.tag || 'farmgirl',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/entities'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus a tab that's already open on the app rather than piling up
      // new ones every time a notification is tapped.
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
