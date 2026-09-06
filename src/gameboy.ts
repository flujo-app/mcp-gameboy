import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import type { FrameResult, GameBoyButton } from './types.js';

interface Core { loadRom(data: Uint8Array): void; doFrame(): void; pressKey(key: string): void; getScreen(): ArrayLike<number>; }
const require = createRequire(import.meta.url);
const Gameboy = require('../vendor/serverboy/src/interface.js') as new () => Core;

/** This module is imported only by the isolated worker. */
export class GameBoyEmulator {
  private core?: Core;
  private frames = 0;
  load(data: Uint8Array): FrameResult {
    const candidate = new Gameboy();
    candidate.loadRom(Buffer.from(data));
    for (let i = 0; i < 5; i++) candidate.doFrame();
    const previous = this.core; const previousFrames = this.frames;
    this.core = candidate; this.frames = 5;
    try { return this.screen(); }
    catch (error) { this.core = previous; this.frames = previousFrames; throw error; }
  }
  advance(frames: number, button?: GameBoyButton): FrameResult {
    if (!this.core) throw new Error('No ROM loaded.');
    for (let i = 0; i < frames; i++) {
      if (button) this.core.pressKey(button);
      this.core.doFrame();
      this.frames++;
    }
    // Preserve the original release frame after a button operation.
    if (button) { this.core.doFrame(); this.frames++; }
    return this.screen();
  }
  private screen(): FrameResult {
    const pixels = this.core!.getScreen();
    if (pixels.length !== 160 * 144 * 4) throw new Error('Emulator returned an invalid screen.');
    const png = new PNG({ width: 160, height: 144 });
    png.data = Buffer.from(pixels);
    return { png: PNG.sync.write(png).toString('base64'), frames: this.frames };
  }
}
