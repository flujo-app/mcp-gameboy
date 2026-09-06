import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { EmulatorService } from './emulatorService.js';
import { BUTTONS, type GameBoyButton, type FrameResult } from './types.js';

const frames = (value: number) => z.number().int().min(1).max(600).default(value);
const none = z.object({}).strict();
export const definitions = [
  ...BUTTONS.map(button => ({ name: 'press_' + button.toLowerCase(), description: 'Press ' + button + ' for 1–600 frames, then release for one frame.', schema: z.object({ duration_frames: frames(25) }).strict(), readOnly: false })),
  { name: 'wait_frames', description: 'Advance 1–600 frames without pressing buttons.', schema: z.object({ duration_frames: frames(100) }).strict(), readOnly: false },
  { name: 'load_rom', description: 'Load a .gb/.gbc file inside ROM_DIR (or the exact configured ROM_PATH), replacing the current cartridge.', schema: z.object({ romPath: z.string().min(1).max(4096) }).strict(), readOnly: false },
  { name: 'get_screen', description: 'Advance one frame and return the 160×144 PNG screen.', schema: none, readOnly: false },
  { name: 'is_rom_loaded', description: 'Read emulator availability, loaded cartridge and frame count.', schema: none, readOnly: true },
  { name: 'list_roms', description: 'List regular .gb/.gbc files in the configured ROM_DIR.', schema: none, readOnly: true }
];
const screenshot = (frame: FrameResult) => ({ content: [{ type: 'image' as const, data: frame.png, mimeType: 'image/png' }] });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
export async function invokeTool(service: EmulatorService, name: string, args: unknown, signal?: AbortSignal) {
  const definition = definitions.find(tool => tool.name === name);
  if (!definition) throw new Error('Unknown tool: ' + name);
  const input = definition.schema.parse(args ?? {}) as { duration_frames?: number; romPath?: string };
  if (name.startsWith('press_')) return screenshot(await service.pressButton(name.slice(6).toUpperCase() as GameBoyButton, input.duration_frames!, signal));
  switch (name) {
    case 'load_rom': return screenshot(await service.loadRom(input.romPath!, signal));
    case 'wait_frames': return screenshot(await service.advance(input.duration_frames!, signal));
    case 'get_screen': return screenshot(await service.advance(1, signal));
    case 'list_roms': return text(await service.roms.list());
    case 'is_rom_loaded': return text(service.status());
    default: throw new Error('Unknown tool.');
  }
}
export function registerGameBoyTools(server: McpServer, service: EmulatorService): void {
  for (const tool of definitions) server.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.schema,
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.name === 'load_rom', idempotentHint: tool.readOnly, openWorldHint: false }
  }, async (args, context) => {
    try { return await invokeTool(service, tool.name, args, context.mcpReq.signal); }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Tool failed.' }] }; }
  });
}
