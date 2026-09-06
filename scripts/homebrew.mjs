/** Original MIT-licensed test cartridge. No boot ROM, logo, game code or assets.
 * Register behavior: https://gbdev.io/pandocs/Joypad_Input.html
 * Serverboy starts after the boot ROM; this fixture intentionally leaves the logo blank.
 * Draws a gray tile. A latches black; B restores gray. */
export function homebrewRom() {
  const rom = Buffer.alloc(32768);
  rom.set([0xc3, 0x50, 0x01], 0x100);
  rom.write('MCP HOMEBREW', 0x134, 'ascii');
  const bytes = [];
  const labels = new Map(), jumps = [];
  const emit = (...values) => bytes.push(...values);
  const label = name => labels.set(name, bytes.length);
  const jr = (opcode, target) => { emit(opcode, 0); jumps.push([bytes.length - 1, target]); };
  emit(0xf3, 0x31, 0xff, 0xdf); // DI; LD SP,$DFFF
  emit(0xaf, 0xe0, 0x40); // LCD off
  emit(0x21, 0x00, 0x80, 0x06, 0x08); // tile 0: eight gray rows
  label('tile'); emit(0x3e, 0xff, 0x22, 0xaf, 0x22, 0x05); jr(0x20, 'tile');
  emit(0x21, 0x00, 0x98, 0x01, 0x00, 0x04);
  label('map'); emit(0xaf, 0x22, 0x0b, 0x78, 0xb1); jr(0x20, 'map');
  emit(0x3e, 0xe4, 0xe0, 0x47, 0x3e, 0x91, 0xe0, 0x40);
  label('poll'); emit(0x3e, 0x10, 0xe0, 0x00, 0xf0, 0x00, 0xe6, 0x01);
  jr(0x20, 'checkB'); emit(0x3e, 0xfc, 0xe0, 0x47);
  label('checkB'); emit(0xf0, 0x00, 0xe6, 0x02); jr(0x20, 'poll'); emit(0x3e, 0xe4, 0xe0, 0x47); jr(0x18, 'poll');
  for (const [position, target] of jumps) bytes[position] = (labels.get(target) - position - 1) & 255;
  rom.set(bytes, 0x150);
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - rom[i] - 1) & 255;
  rom[0x14d] = checksum;
  const sum = rom.reduce((a, b) => a + b, 0) & 65535;
  rom.writeUInt16BE(sum, 0x14e);
  return rom;
}
