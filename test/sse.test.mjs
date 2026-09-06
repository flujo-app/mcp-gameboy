import { it, expect } from 'vitest';
import { httpFixture, request, TOKEN } from './helpers.mjs';

async function openStream(origin, pathname) {
  const controller = new AbortController();
  const response = await fetch(origin + pathname, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'text/event-stream' }, signal: controller.signal });
  expect(response.status).toBe(200);
  const reader = response.body.getReader();
  let text = '';
  const next = async () => {
    while (!text.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE closed early.');
      text += Buffer.from(chunk.value).toString();
    }
    const index = text.indexOf('\n\n'), event = text.slice(0, index); text = text.slice(index + 2);
    return { name: event.split('\n').find(line => line.startsWith('event: '))?.slice(7), data: event.split('\n').find(line => line.startsWith('data: '))?.slice(6) };
  };
  const endpoint = await next();
  expect(endpoint.name).toBe('endpoint');
  return { endpoint: endpoint.data, next, close: () => controller.abort() };
}
it('supports two independent authenticated legacy SSE connections sharing the operator emulator', async () => {
  const f = await httpFixture();
  const streams = [];
  try {
    streams.push(await openStream(f.origin, '/mcp'), await openStream(f.origin, '/sse'));
    expect(streams[0].endpoint).not.toBe(streams[1].endpoint);
    for (const stream of streams) {
      const response = await request(f.origin, stream.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sse-test', version: '1' } } }) });
      expect(response.status).toBe(202);
      const result = JSON.parse((await stream.next()).data);
      expect(result.result.serverInfo.name).toBe('serverboy');
      await request(f.origin, stream.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
      await request(f.origin, stream.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
      expect(JSON.parse((await stream.next()).data).result.tools).toHaveLength(13);
    }
    expect((await request(f.origin, streams[0].endpoint, { method: 'POST', authorized: false })).status).toBe(401);
  } finally { streams.forEach(stream => stream.close()); await f.close(); }
}, 15000);
