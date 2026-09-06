import http from 'node:http';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RomRepository } from '../dist/romRepository.js';
import { EmulatorService } from '../dist/emulatorService.js';
import { createHttpApp } from '../dist/server/sse.js';
import { homebrewRom } from '../scripts/homebrew.mjs';

export const TOKEN = 'fixture_operator_key_012345678901234567890';
export const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'regression', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
export async function fixture(options) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'gameboy-test-')));
  await writeFile(path.join(directory, 'homebrew.gb'), homebrewRom());
  const roms = await RomRepository.create(directory);
  const service = new EmulatorService(roms, options);
  return { directory, roms, service, close: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
export async function httpFixture(options) {
  const f = await fixture(options);
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const application = createHttpApp(f.service, origin, TOKEN);
  server.on('request', application.app);
  return { ...f, origin, close: async () => { await application.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
export function request(origin, pathname, { method = 'GET', headers = {}, body, authorized = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + pathname, { method, headers: { ...(authorized ? { Authorization: 'Bearer ' + TOKEN } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, data, text: data.toString(), json: () => JSON.parse(data.toString().startsWith('event:') ? data.toString().split('\n').find(line => line.startsWith('data: ')).slice(6) : data.toString()) });
      });
    });
    req.once('error', reject); req.setTimeout(10000, () => req.destroy(new Error('Request timed out')));
    req.end(body);
  });
}
export async function rpc(f, method, params = {}, modern = true, id = 1) {
  return request(f.origin, '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(modern ? { 'Mcp-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(params.name ? { 'Mcp-Name': params.name } : {}) } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, ...(modern ? { _meta: meta } : {}) } }) });
}
export function multipart(filename, data) {
  const boundary = 'gameboy_fixture_boundary';
  return { headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }, body: Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="rom"; filename="' + filename + '"\r\nContent-Type: application/octet-stream\r\n\r\n'),
    data, Buffer.from('\r\n--' + boundary + '--\r\n') ]) };
}
