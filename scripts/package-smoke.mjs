import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { wireSmoke } from './wire-smoke.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'gb-package-'));
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run with npm run test:package.');
const npm = (args, cwd) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' } });
try {
  const pack = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory], process.cwd()))[0];
  assert.ok(pack.files.some(file => file.path === 'dist/emulator-worker.js'));
  assert.ok(pack.files.some(file => file.path === 'vendor/serverboy/LICENSE'));
  assert.ok(!pack.files.some(file => /\.(gb|gbc)$/i.test(file.path) || file.path.startsWith('roms/') || file.path.startsWith('public/')));
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, name: 'installed-gameboy-probe', version: '1.0.0' }));
  npm(['install', path.join(directory, pack.filename), '--omit=dev', '--no-fund', '--no-audit'], directory);
  const installed = path.join(directory, 'node_modules', 'mcp-gameboy');
  const entry = path.join(installed, 'dist', 'index.js');
  const require = createRequire(entry);
  for (const obsolete of ['canvas', 'serverboy', '@modelcontextprotocol/sdk/server/mcp.js']) assert.throws(() => require.resolve(obsolete), { code: 'MODULE_NOT_FOUND' });
  await readFile(path.join(directory, 'node_modules', '.bin', process.platform === 'win32' ? 'mcp-gameboy.cmd' : 'mcp-gameboy'));
  const scan = async root => { for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.isDirectory()) await scan(path.join(root, item.name));
    else assert.ok(!/\.(gb|gbc)$/i.test(item.name), 'No ROM may ship in the production installation: ' + item.name);
  } };
  await scan(path.join(directory, 'node_modules'));
  for (const modern of [true, false]) for (const preload of [false, true]) await wireSmoke(entry, modern, preload);
  const audit = JSON.parse(npm(['audit', '--omit=dev', '--json'], directory));
  assert.equal(audit.metadata.vulnerabilities.total, 0);
  console.log('production-only package passed; no ROM/native canvas/runtime SDK1; audit0; size=' + pack.size);
} finally { await rm(directory, { recursive: true, force: true }); }
