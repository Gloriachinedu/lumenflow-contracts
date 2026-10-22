import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const serviceWorkerSource = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
const cacheVersion = serviceWorkerSource.match(/const CACHE_VERSION = '([^']+)'/)[1];
const currentCacheName = `lumenflow-${cacheVersion}`;

function createServiceWorker() {
  const listeners = new Map();
  const deletedCaches = [];
  const openedCaches = [];
  let claimedClients = 0;
  let skippedWaiting = 0;
  const caches = {
    open: async (name) => {
      openedCaches.push(name);
      return {
        add: async () => {},
        put: async () => {},
      };
    },
    keys: async () => ['lumenflow-v0.0.0', currentCacheName],
    delete: async (name) => {
      deletedCaches.push(name);
      return true;
    },
  };
  const self = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    clients: { claim: async () => { claimedClients += 1; } },
    location: { origin: 'https://pay.lumenflow.io' },
    skipWaiting: async () => { skippedWaiting += 1; },
  };

  vm.runInNewContext(serviceWorkerSource, { caches, self, URL, Response, console });

  return {
    deletedCaches,
    openedCaches,
    trigger: async (type) => {
      let pending;
      listeners.get(type)({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    get claimedClients() { return claimedClients; },
    get skippedWaiting() { return skippedWaiting; },
  };
}

test('service worker activation removes caches from older versions and claims clients', async () => {
  const worker = createServiceWorker();

  await worker.trigger('activate');

  assert.deepEqual(worker.deletedCaches, ['lumenflow-v0.0.0']);
  assert.equal(worker.claimedClients, 1);
});

test('service worker install uses a versioned cache and activates immediately', async () => {
  const worker = createServiceWorker();

  await worker.trigger('install');

  assert.equal(worker.openedCaches[0], currentCacheName);
  assert.match(worker.openedCaches[0], /^lumenflow-v\d+\.\d+\.\d+$/);
  assert.equal(worker.skippedWaiting, 1);
});