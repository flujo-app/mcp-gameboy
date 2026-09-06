import { createHash } from 'node:crypto';
import type { Express } from 'express';

const script = String.raw`
let token = '';
let generation = 0;
let connection = new AbortController();
let timer;
let busy = false;
let imageUrl;
const byId = id => document.getElementById(id);
const status = message => { byId('status').textContent = message; };
function setBusy(value) {
  busy = value;
  byId('controls').setAttribute('aria-busy', String(value));
  for (const button of document.querySelectorAll('button')) if (button.id !== 'disconnect') button.disabled = value;
}
function current(epoch) { if (epoch !== generation) throw new Error('Connection ended.'); }
async function api(path, options = {}) {
  const epoch = generation;
  const headers = { ...options.headers, Authorization: 'Bearer ' + token };
  const response = await fetch(path, { ...options, headers, cache: 'no-store', signal: connection.signal });
  current(epoch);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Request failed: ' + response.status);
  }
  return response;
}
async function showScreen() {
  const epoch = generation;
  const response = await api('/screen');
  const blob = await response.blob();
  current(epoch);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = URL.createObjectURL(blob);
  byId('screen').src = imageUrl;
}
async function refresh() {
  const epoch = generation;
  const state = await (await api('/api/status')).json();
  current(epoch);
  byId('cartridge').textContent = state.romLoaded ? state.romPath.split(/[\\/]/).pop() + ' · ' + state.frames + ' frames' : 'No ROM loaded';
  if (state.romLoaded) await showScreen();
}
async function tool(name, args = {}) {
  const epoch = generation;
  const result = await (await api('/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: name, arguments: args }) })).json();
  current(epoch);
  if (result.isError) throw new Error(result.content[0].text);
  await refresh();
}
async function list() {
  const epoch = generation;
  const roms = await (await api('/api/roms')).json();
  current(epoch);
  byId('roms').replaceChildren();
  for (const rom of roms) {
    const option = document.createElement('option');
    option.value = rom.path; option.textContent = rom.name; byId('roms').append(option);
  }
}
async function action(callback) {
  if (busy) return;
  setBusy(true); status('Working…');
  const epoch = generation;
  try { await callback(); if (epoch === generation) status('Ready'); } catch (error) { if (epoch === generation) { status(error.message); byId('autoplay').checked = false; } }
  finally { if (epoch === generation) setBusy(false); }
}
byId('connect').addEventListener('submit', event => {
  event.preventDefault();
  connection.abort(); connection = new AbortController(); generation++; setBusy(false);
  token = byId('token').value; byId('token').value = '';
  action(async () => { await refresh(); await list(); byId('controls').hidden = false; byId('connect').hidden = true; });
});
byId('disconnect').onclick = () => { token = ''; generation++; connection.abort(); setBusy(false); byId('controls').hidden = true; byId('connect').hidden = false; byId('autoplay').checked = false; clearTimeout(timer); byId('roms').replaceChildren(); byId('cartridge').textContent = ''; if (imageUrl) URL.revokeObjectURL(imageUrl); byId('screen').removeAttribute('src'); status('Disconnected'); };
byId('load').onclick = () => action(() => tool('load_rom', { romPath: byId('roms').value }));
byId('upload').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const file = byId('file').files[0];
    if (!file) throw new Error('Choose a .gb or .gbc ROM.');
    const form = new FormData(); form.append('rom', file);
    await api('/upload', { method: 'POST', body: form }); await list(); byId('file').value = '';
  });
});
for (const button of document.querySelectorAll('[data-button]')) button.onclick = () => action(() => tool('press_' + button.dataset.button, { duration_frames: Number(byId('frames').value) }));
byId('skip').onclick = () => action(() => tool('wait_frames', { duration_frames: 100 }));
async function tick() {
  const epoch = generation;
  if (!byId('autoplay').checked || !token) return;
  if (!busy) await action(() => tool('get_screen'));
  if (epoch === generation && byId('autoplay').checked && token) timer = setTimeout(tick, 17);
}
byId('autoplay').onchange = () => { clearTimeout(timer); if (byId('autoplay').checked) tick(); };
window.addEventListener('pagehide', () => { token = ''; generation++; connection.abort(); clearTimeout(timer); if (imageUrl) URL.revokeObjectURL(imageUrl); });
`;
export function setupWebUI(app: Express): void {
  const hash = createHash('sha256').update(script).digest('base64');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameBoy MCP</title>
<style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px;background:#131b1a;color:#eef6e7}button,input,select{font:inherit;padding:9px;margin:5px;border-radius:5px}button{cursor:pointer}fieldset{margin:16px 0;border:1px solid #668272}img{display:block;width:320px;height:288px;image-rendering:pixelated;background:#9bb07d}p{line-height:1.5}#status{min-height:24px;color:#cbdc9b}[hidden]{display:none!important}</style>
<h1>GameBoy MCP</h1><p>Load a cartridge, use the controls, or let your MCP client play. The web interface shares one emulator with connected clients.</p>
<form id="connect"><label>Operator key <input id="token" type="password" autocomplete="off" required minlength="32"></label><button>Connect</button></form>
<p id="status" role="status">Enter the operator key configured on the server.</p>
<section id="controls" hidden><button id="disconnect">Disconnect</button><p id="cartridge"></p><img id="screen" alt="GameBoy screen">
<fieldset><legend>Cartridge</legend><select id="roms" aria-label="ROM"></select><button id="load">Load ROM</button><form id="upload"><input id="file" type="file" accept=".gb,.gbc" aria-label="Upload ROM"><button>Upload</button></form><p>Use your own .gb or .gbc file (32 KiB–8 MiB). Uploads never overwrite existing files.</p></fieldset>
<fieldset><legend>Controls</legend><label>Hold frames <input id="frames" type="number" min="1" max="600" value="25"></label><div>
<button data-button="up">UP</button><button data-button="down">DOWN</button><button data-button="left">LEFT</button><button data-button="right">RIGHT</button><button data-button="a">A</button><button data-button="b">B</button><button data-button="start">START</button><button data-button="select">SELECT</button></div>
<button id="skip">Skip 100 frames</button><label><input id="autoplay" type="checkbox">Auto-play</label></fieldset></section><script>${script}</script></html>`;
  app.get(['/', '/emulator', '/test'], (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'sha256-" + hash + "'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.type('html').send(html);
  });
}
