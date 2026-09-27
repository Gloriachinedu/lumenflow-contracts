import assert from 'node:assert/strict';
import { test } from 'node:test';

const adminUrl = process.env.TOXIPROXY_ADMIN_URL ?? 'http://localhost:8474';
const proxyName = process.env.TOXIPROXY_PROXY ?? 'lumenflow-rpc';
const enabled = process.env.CHAOS_TESTS === '1';

async function toxiproxy(path, options = {}) {
  const response = await fetch(`${adminUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  assert.ok(response.ok, `Toxiproxy request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function addToxic(type, attributes) {
  return toxiproxy(`/proxies/${proxyName}/toxics`, {
    method: 'POST',
    body: JSON.stringify({ name: `${type}-chaos`, type, stream: 'downstream', attributes }),
  });
}

test('RPC timeout is injected through Toxiproxy', { skip: !enabled }, async () => {
  await addToxic('timeout', { timeout: 100 });
  await toxiproxy(`/proxies/${proxyName}/toxics/timeout-chaos`, { method: 'DELETE' });
});

test('slow RPC response is injected through Toxiproxy', { skip: !enabled }, async () => {
  await addToxic('latency', { latency: 5000, jitter: 0 });
  await toxiproxy(`/proxies/${proxyName}/toxics/latency-chaos`, { method: 'DELETE' });
});

test('partial response is injected through Toxiproxy', { skip: !enabled }, async () => {
  await addToxic('limit_data', { bytes: 64 });
  await toxiproxy(`/proxies/${proxyName}/toxics/limit_data-chaos`, { method: 'DELETE' });
});