/* 音感练习 - Service Worker
 * 作用：把音色文件（钢琴专用，约 2.1MB）缓存到本地，刷新页面无需重新下载。
 * 策略：soundfonts 目录下的文件采用「缓存优先」，首次访问联网下载并入库，之后直接读本地。
 * 安装阶段会后台预热缓存，让「第二次刷新就命中」。
 * 注意：更新 soundfonts 目录里的音色文件后，需要把下方 CACHE_NAME 的版本号 +1 才会重新下载。
 */
'use strict';

var CACHE_NAME = 'yinxue-soundfont-v2';
var SOUNDFONTS = ['./soundfonts/GeneralUserGS-Trimmed.sf2'];

/* 安装阶段后台预热：
 * 页面首次加载时请求往往抢在 SW 接管之前发出（绕过了 SW，进不了缓存），
 * 但那次下载会留在 HTTP 缓存里（Pages 下发 max-age=600），
 * 这里 10 分钟内去取可直接命中 HTTP 缓存，基本不产生真实二次下载。 */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (c) {
      return Promise.all(SOUNDFONTS.map(function (u) {
        return c.match(u).then(function (hit) {
          return hit ? null : c.add(u).catch(function () {});
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

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
