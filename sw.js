const name = 'marge-app-v4';
const shell = ['index.html','style.css','app.js','learning.js','dictionary.js','storage.js','glossary.js','frontier.js','icon.svg','app.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(name).then(cache=>cache.addAll(shell)));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(names=>Promise.all(names.filter(key=>key.startsWith('marge-app-')&&key!==name).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch',event=>{
  const url = new URL(event.request.url);
  if (event.request.method!=='GET'||url.origin!==self.location.origin) return;
  const asset = shell.includes(url.pathname.split('/').pop());
  if (event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.match('index.html')));
  } else if (asset) {
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
  }
});
