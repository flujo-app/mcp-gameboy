import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { wireSmoke } from './wire-smoke.mjs';

const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const image = 'mcp-gameboy-release-test';
docker(['build', '-t', image, '.']);
assert.equal(docker(['run', '--rm', '--entrypoint', 'id', image, '-u']), '1000');
for (const modern of [true, false]) await wireSmoke('', modern, false, image);
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const token = randomBytes(32).toString('base64url');
const id = docker(['run', '-d', '--rm', '-p', '127.0.0.1:' + port + ':3001', '-e', 'SERVER_HOST=0.0.0.0', '-e', 'MCP_PUBLIC_URL=' + origin, '-e', 'MCP_OPERATOR_TOKEN=' + token, image, '--http']);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  assert.equal((await fetch(origin + '/api/status')).status, 401);
  const response = await fetch(origin + '/api/status', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(response.status, 200); assert.equal((await response.json()).romLoaded, false);
  assert.equal((await fetch(origin + '/api/status', { headers: { Authorization: 'Bearer ' + token, Origin: 'https://evil.example' } })).status, 403);
  console.log('Docker passed: nonroot, both protocols/actual emulator, authenticated HTTP and health.');
} finally { docker(['stop', '--time', '5', id]); }
