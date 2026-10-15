/* 音感练习 - Service Worker
 * 作用：把音色文件（约 8MB）缓存到本地，刷新页面无需重新下载。
 * 策略：soundfonts 目录下的文件采用「缓存优先」，首次访问联网下载并入库，之后直接读本地。
 * 注意：更新 soundfonts 目录里的音色文件后，需要把下方 CACHE_NAME 的版本号 +1 才会重新下载。
 */
'use strict';

var CACHE_NAME = 'yinxue-soundfont-v1';

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/soundfonts/') === -1) return;

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () {
        return caches.match('./soundfonts/GeneralUserGS-Trimmed.sf2');
      });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
