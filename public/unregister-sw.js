// Drop any service worker left from an older visit. This file is not a Workbox worker:
// the app does not register one. If a controller is still serving a cached bundle, unregister
// it and reload once so the next document comes from the network.
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    if (!registrations.length) return;
    return Promise.all(registrations.map(function (registration) { return registration.unregister(); })).then(function () {
      var cleared = /(?:\?|&)zoki-sw-cleared=1(?:&|$)/.test(location.search);
      if (navigator.serviceWorker.controller && !cleared) {
        var next = new URL(location.href);
        next.searchParams.set('zoki-sw-cleared', '1');
        location.replace(next.href);
      }
    });
  }).catch(function () {});
})();
