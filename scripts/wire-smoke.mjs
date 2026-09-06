import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homebrewRom } from './homebrew.mjs';

export async function wireSmoke(entry, modern, preload = false, dockerImage) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gb-wire-'));
  await writeFile(path.join(directory, 'homebrew.gb'), homebrewRom());
  // The generated read-only fixture is shared with the container's nonroot UID.
  if (dockerImage) await chmod(directory, 0o755);
  const command = dockerImage ? 'docker' : process.execPath;
  const args = dockerImage ? ['run', '--rm', '-i', '--mount', 'type=bind,source=' + directory + ',target=/data/roms,readonly',
    '--env', 'ROM_DIR=/data/roms', ...(preload ? ['--env', 'ROM_PATH=/data/roms/homebrew.gb'] : []), dockerImage] : [path.resolve(entry), '--stdio'];
  const child = spawn(command, args, { cwd: directory,
    env: { ...process.env, ROM_DIR: directory, ROM_PATH: preload ? './homebrew.gb' : '', MCP_OPERATOR_TOKEN: '' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '', stderr = '', stopped = false;
  const responses = new Map(), invalid = [];
  const exit = new Promise(resolve => child.once('exit', (code, signal) => { stopped = true; resolve({ code, signal }); }));
  child.on('error', error => { stderr += error.message; });
  child.stdout.on('data', chunk => {
    out += chunk.toString();
    while (out.includes('\n')) {
      const end = out.indexOf('\n'), line = out.slice(0, end).trim(); out = out.slice(end + 1);
      if (!line) continue;
      try { const message = JSON.parse(line); if (message.id !== undefined) responses.set(message.id, message); }
      catch { invalid.push(line); }
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-32000); });
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'package-wire', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
  let id = 0;
  async function rpc(method, params = {}) {
    const key = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params: { ...params, ...(modern ? { _meta: meta } : {}) } }) + '\n');
    const deadline = Date.now() + 15000;
    while (!responses.has(key)) {
      if (stopped || Date.now() > deadline) throw new Error('No wire response for ' + method + ': ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const message = responses.get(key);
    assert.equal(message.error, undefined, JSON.stringify(message));
    return message.result;
  }
  try {
    if (modern) {
      const discovered = await rpc('server/discover');
      assert.equal(discovered._meta['io.modelcontextprotocol/serverInfo'].name, 'serverboy');
    } else {
      const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } });
      assert.equal(initialized.serverInfo.name, 'serverboy');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    }
    const tools = (await rpc('tools/list')).tools;
    assert.equal(tools.length, 13);
    const initial = await rpc('tools/call', { name: 'is_rom_loaded', arguments: {} });
    assert.equal(JSON.parse(initial.content[0].text).romLoaded, preload);
    const loaded = await rpc('tools/call', { name: 'load_rom', arguments: { romPath: 'homebrew.gb' } });
    assert.equal(loaded.isError, undefined, JSON.stringify(loaded));
    if (modern) assert.equal(loaded.resultType, 'complete');
    const a = await rpc('tools/call', { name: 'press_a', arguments: { duration_frames: 25 } });
    const b = await rpc('tools/call', { name: 'press_b', arguments: { duration_frames: 25 } });
    assert.equal(a.content[0].mimeType, 'image/png');
    const png = Buffer.from(a.content[0].data, 'base64');
    assert.equal(png.readUInt32BE(16), 160); assert.equal(png.readUInt32BE(20), 144);
    assert.notEqual(a.content[0].data, b.content[0].data);
    const invalidPath = await rpc('tools/call', { name: 'load_rom', arguments: { romPath: '../outside.gb' } });
    assert.equal(invalidPath.isError, true);
    child.stdin.end();
    const ended = await Promise.race([exit, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('stdin EOF did not stop process: ' + stderr)), 10000);
      exit.then(() => clearTimeout(timer));
    })]);
    assert.equal(ended.code, 0);
    assert.deepEqual(invalid, [], 'stdout must contain JSON-RPC only');
    assert.equal(out.trim(), '');
    console.log('wire passed: ' + (modern ? '2026-07-28' : 'legacy') + ', preload=' + preload + ', actual ROM/buttons/PNG, EOF');
  } finally {
    if (!stopped) { child.kill(); await exit; }
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const modern of [true, false]) for (const preload of [false, true]) await wireSmoke('dist/index.js', modern, preload);
}
