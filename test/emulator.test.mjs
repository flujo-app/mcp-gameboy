import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture } from './helpers.mjs';
import { homebrewRom } from '../scripts/homebrew.mjs';
import { romFilename, validateRom, RomRepository } from '../dist/romRepository.js';

describe('actual isolated Serverboy emulator', () => {
  it('renders the original ROM and executes A/B presses, releases and frame skips', async () => {
    const f = await fixture();
    try {
      expect(f.service.status().romLoaded).toBe(false);
      const initial = await f.service.loadRom('homebrew.gb');
      const a = await f.service.pressButton('A', 25);
      const released = await f.service.advance(5);
      const b = await f.service.pressButton('B', 25);
      const image = PNG.sync.read(Buffer.from(a.png, 'base64'));
      expect([image.width, image.height]).toEqual([160, 144]);
      expect([initial.frames, a.frames, released.frames, b.frames]).toEqual([5, 31, 36, 62]);
      expect(a.png).toBe(released.png);
      expect(a.png).not.toBe(b.png);
      expect(f.service.status().romPath).toBe(path.join(f.directory, 'homebrew.gb'));
    } finally { await f.close(); }
  });
  it('stops CPU work at the deadline, rejects queued work and can reload after reset', async () => {
    const f = await fixture({ operationTimeoutMs: 1 });
    try {
      await f.service.loadRom('homebrew.gb');
      const results = await Promise.allSettled([f.service.advance(600), f.service.advance(1)]);
      expect(results.every(result => result.status === 'rejected')).toBe(true);
      expect(results[0].reason.message).toMatch(/timed out/);
      expect(f.service.status().romLoaded).toBe(false);
      await f.service.loadRom('homebrew.gb');
      expect(f.service.status().romLoaded).toBe(true);
    } finally { await f.close(); }
  });
  it('bounds frame values, queue length and cancelled jobs without replay', async () => {
    const f = await fixture({ operationTimeoutMs: 1, maxQueued: 1 });
    try {
      await f.service.loadRom('homebrew.gb');
      for (const value of [0, -1, 1.5, 601, Infinity, NaN]) expect(() => f.service.advance(value)).toThrow(/integer/);
      const abort = new AbortController(); abort.abort();
      await expect(f.service.loadRom('homebrew.gb', abort.signal)).rejects.toThrow(/cancelled/);
      const results = await Promise.allSettled([f.service.advance(600), f.service.advance(600), f.service.advance(1)]);
      expect(results[2].reason.message).toMatch(/queue is full/);
      await f.service.close();
      await expect(f.service.loadRom('homebrew.gb')).rejects.toThrow(/closed/);
    } finally { await f.close(); }
  });
});
describe('cartridge filesystem boundary', () => {
  it('rejects sibling prefixes, traversal and symlinks outside the root', async () => {
    const f = await fixture();
    const sibling = f.directory + '-other';
    await mkdir(sibling); await writeFile(path.join(sibling, 'outside.gb'), homebrewRom());
    try {
      await expect(f.roms.read(path.join(sibling, 'outside.gb'))).rejects.toThrow(/outside/);
      await expect(f.roms.read('../' + path.basename(sibling) + '/outside.gb')).rejects.toThrow(/outside/);
      try {
        await symlink(path.join(sibling, 'outside.gb'), path.join(f.directory, 'link.gb'), 'file');
        await expect(f.roms.read('link.gb')).rejects.toThrow(/outside/);
        expect(await f.roms.list()).toHaveLength(1);
      } catch (error) { if (error.code !== 'EPERM') throw error; }
      const explicit = await RomRepository.create(f.directory, path.join(sibling, 'outside.gb'));
      expect((await explicit.read(path.join(sibling, 'outside.gb'))).data.length).toBe(32768);
    } finally { await f.close(); await rm(sibling, { recursive: true, force: true }); }
  });
  it('validates bounded data and filename, never overwrites, and rejects directories', async () => {
    const f = await fixture();
    try {
      for (const name of ['../outside.gb', 'a/b.gb', 'a\\b.gb', 'C:evil.gb', 'CON.gb', 'test.txt', 'bad.gb ']) expect(() => romFilename(name)).toThrow();
      for (const data of [Buffer.alloc(4), Buffer.alloc(8 * 1024 * 1024 + 1)]) expect(() => validateRom(data)).toThrow(/size/);
      const wrongHeader = homebrewRom(); wrongHeader[0x148] = 1;
      expect(() => validateRom(wrongHeader)).toThrow(/header/);
      await expect(f.roms.upload('homebrew.gb', homebrewRom())).rejects.toThrow(/exist/);
      await f.roms.upload('second.gbc', homebrewRom());
      expect(await f.roms.list()).toHaveLength(2);
      await mkdir(path.join(f.directory, 'directory.gb'));
      await expect(f.roms.read('directory.gb')).rejects.toThrow(/regular/);
    } finally { await f.close(); }
  });
});

it('cancels queued work without changing the active cartridge, and active cancellation resets it', async () => {
  const f = await fixture();
  try {
    await f.service.loadRom('homebrew.gb');
    const queued = new AbortController();
    const first = f.service.advance(100);
    const second = f.service.advance(100, queued.signal).catch(error => error);
    queued.abort();
    await first;
    expect((await second).message).toMatch(/cancelled/);
    expect(f.service.status().frames).toBe(105);
    const active = new AbortController();
    const running = f.service.advance(600, active.signal).catch(error => error);
    active.abort();
    expect((await running).message).toMatch(/reset/);
    expect(f.service.status().romLoaded).toBe(false);
    await f.service.loadRom('homebrew.gb');
    expect(f.service.status().frames).toBe(5);
  } finally { await f.close(); }
});
it.skipIf(process.platform === 'win32')('rejects named pipes without waiting for a writer', async () => {
  const f = await fixture();
  try {
    execFileSync('mkfifo', [path.join(f.directory, 'pipe.gb')]);
    await expect(f.roms.read('pipe.gb')).rejects.toThrow(/regular/);
  } finally { await f.close(); }
}, 3000);
