import { parentPort } from 'node:worker_threads';
import { GameBoyEmulator } from './gameboy.js';
import { BUTTONS, type WorkerRequest, type WorkerResponse } from './types.js';

const emulator = new GameBoyEmulator();
parentPort!.on('message', (request: WorkerRequest) => {
  const response: WorkerResponse = { id: request.id };
  try {
    if (request.operation === 'load' && request.rom) response.result = emulator.load(request.rom);
    else if (request.operation === 'advance' || request.operation === 'press') {
      if (!Number.isInteger(request.frames) || request.frames! < 1 || request.frames! > 600) throw new Error('Frames must be an integer from 1 to 600.');
      if (request.operation === 'press' && !BUTTONS.includes(request.button!)) throw new Error('Unknown button.');
      response.result = emulator.advance(request.frames!, request.operation === 'press' ? request.button : undefined);
    } else throw new Error('Invalid emulator operation.');
  } catch (error) { response.error = error instanceof Error ? error.message : 'Emulator operation failed.'; }
  parentPort!.postMessage(response);
});
