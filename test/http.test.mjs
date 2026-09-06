import { it, expect } from 'vitest';
import { httpFixture, request, rpc, multipart, TOKEN } from './helpers.mjs';
import { homebrewRom } from '../scripts/homebrew.mjs';
import { createHttpApp } from '../dist/server/sse.js';

it('requires operator authentication on every state, ROM, image and MCP route', async () => {
  const f = await httpFixture();
  try {
    expect(() => createHttpApp(f.service, f.origin, 'short')).toThrow(/MCP_OPERATOR_TOKEN/);
    for (const pathname of ['/api/status', '/api/roms', '/screen', '/mcp', '/sse', '/messages', '/upload', '/gameboy', '/api/tool', '/api/advance_and_get_screen']) {
      for (const method of ['GET', 'POST']) expect((await request(f.origin, pathname, { method, authorized: false })).status).toBe(401);
    }
    const health = await request(f.origin, '/health', { authorized: false });
    expect(health.json()).toEqual({ status: 'ok' });
    const html = await request(f.origin, '/', { authorized: false });
    expect(html.status).toBe(200); expect(html.text).not.toContain('homebrew.gb');
    expect(html.text).not.toContain(TOKEN);
    expect(html.headers['content-security-policy']).toMatch(/sha256-/);
    expect(html.headers['referrer-policy']).toBe('no-referrer');
    expect(html.headers['cache-control']).toBe('no-store');
  } finally { await f.close(); }
});
it('rejects hostile/null Origin and Host mismatches even with a valid bearer', async () => {
  const f = await httpFixture();
  try {
    for (const origin of ['https://evil.example', 'null', f.origin + '/path']) expect((await request(f.origin, '/api/status', { headers: { Origin: origin } })).status).toBe(403);
    for (const host of ['evil.example', '127.0.0.1', '127.0.0.1:80']) expect((await request(f.origin, '/health', { headers: { Host: host } })).status).toBe(403);
    expect((await request(f.origin, '/api/status', { headers: { Origin: f.origin } })).status).toBe(200);
    const preflight = await request(f.origin, '/api/tool', { method: 'OPTIONS', authorized: false, headers: { Origin: f.origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBe(f.origin);
    expect((await request(f.origin, '/api/tool', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } })).status).toBe(403);
  } finally { await f.close(); }
});
it('serves modern discovery and tools alongside legacy initialization with truthful errors', async () => {
  const f = await httpFixture();
  try {
    const wire = await rpc(f, 'server/discover');
    expect(wire.headers['content-type']).toContain('application/json');
    const discovery = wire.json();
    expect(discovery.error).toBeUndefined();
    expect(discovery.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('serverboy');
    const list = (await rpc(f, 'tools/list')).json();
    expect(list.result.tools).toHaveLength(13);
    expect(list.result.tools.find(tool => tool.name === 'get_screen').annotations.readOnlyHint).toBe(false);
    const empty = (await rpc(f, 'tools/call', { name: 'get_screen', arguments: {} })).json();
    expect(empty.result.isError).toBe(true);
    const bad = (await rpc(f, 'tools/call', { name: 'wait_frames', arguments: { duration_frames: 601 } })).json();
    expect(bad.error || bad.result?.isError).toBeTruthy();
    const loaded = (await rpc(f, 'tools/call', { name: 'load_rom', arguments: { romPath: 'homebrew.gb' } })).json();
    expect(loaded.result.content[0].mimeType).toBe('image/png');
    expect(loaded.result.resultType).toBe('complete');
    const legacy = (await rpc(f, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } }, false)).json();
    expect(legacy.result.protocolVersion).toBe('2025-11-25');
    expect(legacy.result.capabilities.roots).toBeUndefined();
    const legacyList = (await rpc(f, 'tools/list', {}, false)).json();
    expect(legacyList.result.tools).toHaveLength(13);
  } finally { await f.close(); }
});
it('validates actual uploads and JSON tool requests; GET routes never mutate', async () => {
  const f = await httpFixture();
  try {
    for (const filename of ['../outside.gb', 'a\\b.gb', 'CON.gb']) expect((await request(f.origin, '/upload', { method: 'POST', ...multipart(filename, homebrewRom()) })).status).toBe(400);
    expect((await request(f.origin, '/upload', { method: 'POST', ...multipart('new.gb', homebrewRom()) })).status).toBe(201);
    expect((await request(f.origin, '/upload', { method: 'POST', ...multipart('new.gb', homebrewRom()) })).status).toBe(400);
    expect((await request(f.origin, '/upload', { method: 'POST', ...multipart('bad.gb', Buffer.alloc(2)) })).status).toBe(400);
    expect((await request(f.origin, '/upload', { method: 'POST', ...multipart('huge.gb', Buffer.alloc(8 * 1024 * 1024 + 1)) })).status).toBe(413);
    for (const route of ['/gameboy?rom=homebrew.gb', '/api/advance_and_get_screen']) expect((await request(f.origin, route)).status).toBe(405);
    expect(f.service.status().romLoaded).toBe(false);
    const invoke = (tool, args) => request(f.origin, '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, arguments: args }) });
    expect((await invoke('load_rom', { romPath: 'new.gb' })).status).toBe(200);
    expect((await invoke('wait_frames', { duration_frames: 1.5 })).status).toBe(400);
    expect((await invoke('missing', {})).status).toBe(400);
    expect((await request(f.origin, '/screen')).headers['content-type']).toContain('image/png');
    expect((await request(f.origin, '/api/status')).json().connected).toBeUndefined();
  } finally { await f.close(); }
});
it('keeps HTTP responsive while a worker is busy and resets on deadline', async () => {
  const f = await httpFixture({ operationTimeoutMs: 1 });
  try {
    await f.service.loadRom('homebrew.gb');
    const result = f.service.advance(600).catch(error => error);
    expect((await request(f.origin, '/health', { authorized: false })).status).toBe(200);
    expect((await result).message).toMatch(/timed out/);
    expect(f.service.status().romLoaded).toBe(false);
  } finally { await f.close(); }
});
