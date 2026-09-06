import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { EmulatorService } from '../emulatorService.js';
import { createGameBoyServer } from './server.js';

export function startStdioServer(service: EmulatorService) {
  return serveStdio(() => createGameBoyServer(service), { legacy: 'serve' });
}
