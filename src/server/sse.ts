import express from 'express';
import type { ErrorRequestHandler } from 'express';
import http from 'node:http';
import multer from 'multer';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { SSEServerTransport } from '@modelcontextprotocol/server-legacy/sse';
import { EmulatorService } from '../emulatorService.js';
import { MAX_ROM_BYTES } from '../romRepository.js';
import { invokeTool } from '../tools.js';
import { createGameBoyServer } from './server.js';
import { operatorGuard, httpBoundary } from '../http-security.js';
import { setupWebUI } from '../ui.js';

export function createHttpApp(service: EmulatorService, origin: string, token?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(httpBoundary(origin));
  const guard = operatorGuard(token);
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  setupWebUI(app);
  app.use(guard);
  app.use(express.json({ limit: '32kb' }));
  const handle = toNodeHandler(createMcpHandler(() => createGameBoyServer(service), { legacy: 'stateless' }));
  const sessions = new Map<string, { transport: SSEServerTransport; server: ReturnType<typeof createGameBoyServer>; timer: ReturnType<typeof setTimeout> }>();
  const drop = async (id: string) => {
    const item = sessions.get(id);
    if (!item) return;
    sessions.delete(id); clearTimeout(item.timer);
    await item.server.close();
  };
  const resetTimer = (id: string) => {
    const item = sessions.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    item.timer = setTimeout(() => { void drop(id); }, 10 * 60 * 1000);
    item.timer.unref();
  };
  const sse: express.RequestHandler = async (req, res, next) => {
    if (sessions.size >= 32) { res.status(503).json({ error: 'SSE session limit reached.' }); return; }
    const transport = new SSEServerTransport('/messages', res);
    const server = createGameBoyServer(service);
    const id = transport.sessionId;
    const timer = setTimeout(() => { void drop(id); }, 10 * 60 * 1000); timer.unref();
    sessions.set(id, { transport, server, timer });
    res.on('close', () => { void drop(id); });
    try { await server.connect(transport); }
    catch (error) { await drop(id); next(error); }
  };
  app.get('/sse', sse);
  app.get('/mcp', (req, res, next) => {
    if (!req.get('mcp-protocol-version')) return sse(req, res, next);
    return handle(req, res, req.body).catch(next);
  });
  app.post('/messages', async (req, res) => {
    const id = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const item = sessions.get(id);
    if (!item) { res.status(404).json({ error: 'SSE session not found.' }); return; }
    resetTimer(id);
    await item.transport.handlePostMessage(req, res, req.body);
  });
  app.all('/mcp', (req, res, next) => { void handle(req, res, req.body).catch(next); });
  app.get('/api/status', (_req, res) => { res.json(service.status()); });
  app.get('/api/roms', async (_req, res) => { res.json(await service.roms.list()); });
  app.get('/screen', (_req, res) => { res.type('png').send(Buffer.from(service.getScreen().png, 'base64')); });
  app.post('/api/advance_and_get_screen', async (_req, res) => { const frame = await service.advance(1); res.type('png').send(Buffer.from(frame.png, 'base64')); });
  app.get(['/api/advance_and_get_screen', '/gameboy'], (_req, res) => { res.set('Allow', 'POST').status(405).json({ error: 'Use an authenticated POST.' }); });
  app.post('/api/tool', async (req, res) => {
    if (!req.body || typeof req.body.tool !== 'string') { res.status(400).json({ error: 'Expected tool and arguments.' }); return; }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    res.json(await invokeTool(service, req.body.tool, req.body.arguments ?? req.body.args, controller.signal));
  });
  app.post('/gameboy', async (req, res) => { res.json(await invokeTool(service, 'load_rom', { romPath: req.body?.rom }, undefined)); });
  let uploads = 0;
  const upload = multer({ storage: multer.memoryStorage(), preservePath: true, limits: { fileSize: MAX_ROM_BYTES, files: 1, fields: 0, parts: 2 } }).single('rom');
  app.post('/upload', (req, res, next) => {
    if (uploads >= 4) { res.status(503).json({ error: 'Upload capacity reached.' }); return; }
    uploads++;
    let released = false;
    const release = () => { if (!released) { released = true; uploads--; } };
    res.once('close', release); res.once('finish', release);
    upload(req, res, error => {
      if (error) { next(error); return; }
      if (!req.file) { res.status(400).json({ error: 'A ROM file is required.' }); return; }
      void service.roms.upload(req.file.originalname, req.file.buffer)
        .then(path => { res.status(201).json({ path }); }).catch(next);
    });
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const tooLarge = error?.code === 'LIMIT_FILE_SIZE' || error?.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({ error: error instanceof Error ? error.message : 'Request failed.' });
  };
  app.use(errors);
  return { app, close: async () => { await Promise.all([...sessions.keys()].map(drop)); } };
}
export async function startHttpServer(service: EmulatorService, host: string, port: number, origin: string) {
  const application = createHttpApp(service, origin);
  const server = http.createServer(application.app);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, close: async () => {
    await application.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
