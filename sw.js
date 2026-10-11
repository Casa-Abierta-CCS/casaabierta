const CACHE_APP = 'casa-abierta-app-v19';
const CACHE_CDN = 'casa-abierta-cdn-v19';

const CDN_ASSETS = [
    'https://unpkg.com/react@18/umd/react.production.min.js',
    'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
    'https://unpkg.com/@babel/standalone/babel.min.js',
    'https://cdn.tailwindcss.com',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Firebase Cloud Messaging — recordatorios push en segundo plano
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCkLKeeaePW7wCpp3IPMrEldZTxP_SknwM",
    authDomain: "casa-abierta-ccs.firebaseapp.com",
    projectId: "casa-abierta-ccs",
    storageBucket: "casa-abierta-ccs.firebasestorage.app",
    messagingSenderId: "772790089728",
    appId: "1:772790089728:web:6180d2ad3192a6fba580e5"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const { title, body } = payload.data || payload.notification || {};
    self.registration.showNotification(title || 'Casa Abierta', {
        body: body || '',
        icon: 'icon-192.png',
        badge: 'icon-192.png'
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(self.registration.scope);
            }
        })
    );
});

// Pre-cachear librerías CDN al instalar
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_CDN)
            .then(cache => cache.addAll(CDN_ASSETS))
            .catch(err => console.warn('[SW] Error pre-cacheando CDN:', err))
    );
    self.skipWaiting();
});

// Limpiar cachés viejas al activar
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_APP && k !== CACHE_CDN)
                    .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Firebase y APIs externas: nunca interceptar
    if (
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('google.com') ||
        url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs')
    ) {
        return;
    }

    // Librerías CDN: cache-first (son archivos inmutables)
    if (url.hostname !== self.location.hostname) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_CDN).then(cache => cache.put(request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // App shell (HTML, SVG, manifest): network-first con fallback a caché
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response && response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_APP).then(cache => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
