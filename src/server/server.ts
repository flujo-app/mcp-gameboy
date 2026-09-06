import { McpServer } from '@modelcontextprotocol/server';
import { EmulatorService } from '../emulatorService.js';
import { registerGameBoyTools } from '../tools.js';

export function createGameBoyServer(service: EmulatorService): McpServer {
  const server = new McpServer({ name: 'serverboy', version: '1.0.0' });
  registerGameBoyTools(server, service);
  return server;
}
