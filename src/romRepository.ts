import { constants } from 'node:fs';
import { mkdir, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const MAX_ROM_BYTES = 8 * 1024 * 1024;
export function validateRom(data: Uint8Array): void {
  if (data.length < 32768 || data.length > MAX_ROM_BYTES) throw new Error('ROM size must be between 32 KiB and 8 MiB.');
  const code = data[0x148];
  const expected = code <= 8 ? 32768 * 2 ** code : ({ 82: 72 * 16384, 83: 80 * 16384, 84: 96 * 16384 } as Record<number, number>)[code];
  if (!expected || data.length !== expected) throw new Error('ROM length does not match its cartridge size header.');
}
export function romFilename(value: string): string {
  if (!value || value.length > 180 || value !== path.basename(value) || /[\\/:<>"|?*\x00-\x1f]/.test(value) ||
      /[. ]$/.test(value) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value) ||
      !/\.(gb|gbc)$/i.test(value)) throw new Error('Use a plain .gb or .gbc filename without path components.');
  return value;
}
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export class RomRepository {
  private constructor(readonly root: string, private initialFile?: string) {}
  static async create(directory: string, initialFile?: string): Promise<RomRepository> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await realpath(directory);
    return new RomRepository(root, initialFile ? await realpath(path.resolve(initialFile)) : undefined);
  }
  async read(value: string): Promise<{ data: Buffer; path: string }> {
    if (!value || value.length > 4096 || value.includes('\0')) throw new Error('Invalid ROM path.');
    if (!/\.(gb|gbc)$/i.test(value)) throw new Error('Only .gb and .gbc ROM files are accepted.');
    const resolved = await realpath(path.resolve(this.root, value));
    if (!inside(this.root, resolved) && resolved !== this.initialFile) throw new Error('ROM is outside the configured ROM_DIR.');
    const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 32768 || stat.size > MAX_ROM_BYTES) throw new Error('ROM must be a regular file between 32 KiB and 8 MiB.');
      // Fixed allocation and read limit also bound files that grow after stat().
      const data = Buffer.alloc(stat.size + 1);
      let total = 0;
      while (total < data.length) {
        const { bytesRead } = await handle.read(data, total, data.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total !== stat.size) throw new Error('ROM changed while reading.');
      const rom = data.subarray(0, total);
      validateRom(rom);
      return { data: rom, path: resolved };
    } finally { await handle.close(); }
  }
  async list(): Promise<Array<{ name: string; path: string }>> {
    const result: Array<{ name: string; path: string }> = [];
    let count = 0;
    const entries = await opendir(this.root);
    for await (const entry of entries) {
      if (++count > 1000) throw new Error('ROM directory has more than 1000 entries.');
      if (!entry.isFile() || !/\.(gb|gbc)$/i.test(entry.name)) continue;
      result.push({ name: entry.name, path: path.join(this.root, entry.name) });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  async upload(name: string, data: Buffer): Promise<string> {
    romFilename(name); validateRom(data);
    if (await realpath(this.root) !== this.root) throw new Error('ROM directory changed.');
    const destination = path.join(this.root, name);
    const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(data); } finally { await handle.close(); }
    return destination;
  }
}
