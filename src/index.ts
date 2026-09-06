#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'node:path';
import { RomRepository } from './romRepository.js';
import { EmulatorService } from './emulatorService.js';
import { startStdioServer } from './server/stdio.js';
import { startHttpServer } from './server/sse.js';
import { publicOrigin } from './http-security.js';

dotenv.config({ quiet: true });
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('mcp-gameboy [--stdio] [--ui] | --http | --sse\nROM_DIR and optional ROM_PATH configure files. HTTP requires MCP_OPERATOR_TOKEN.\n');
    return;
  }
  if (args.some(arg => !['--stdio', '--http', '--sse', '--ui'].includes(arg)) ||
      (args.includes('--stdio') && (args.includes('--http') || args.includes('--sse')))) throw new Error('Invalid transport arguments; use --help.');
  const httpOnly = args.includes('--http') || args.includes('--sse');
  const useHttp = httpOnly || args.includes('--ui');
  const host = process.env.SERVER_HOST ?? '127.0.0.1';
  const rawPort = process.env.SERVER_PORT ?? process.env.PORT ?? '3001';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('SERVER_PORT must be 1–65535.');
  const port = Number(rawPort);
  // Validate HTTP settings before touching files or starting an emulator.
  const origin = useHttp ? publicOrigin(host, port) : undefined;
  if (useHttp && !/^[A-Za-z0-9_-]{32,256}$/.test(process.env.MCP_OPERATOR_TOKEN ?? '')) throw new Error('HTTP requires MCP_OPERATOR_TOKEN: 32–256 random URL-safe characters.');
  const roms = await RomRepository.create(process.env.ROM_DIR ?? './roms', process.env.ROM_PATH);
  const service = new EmulatorService(roms);
  let web: Awaited<ReturnType<typeof startHttpServer>> | undefined;
  let stdio: Awaited<ReturnType<typeof startStdioServer>> | undefined;
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    await Promise.allSettled([web?.close(), stdio?.close(), service.close()]);
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  try {
    if (process.env.ROM_PATH) await service.loadRom(path.resolve(process.env.ROM_PATH));
    if (useHttp) {
      web = await startHttpServer(service, host, port, origin!);
      process.stderr.write('GameBoy HTTP interface: ' + origin + '\n');
    }
    if (!httpOnly) {
      process.stdin.once('end', () => { void close(); });
      stdio = await startStdioServer(service);
    }
  } catch (error) { await close(); throw error; }
}
main().catch(error => { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1; });
