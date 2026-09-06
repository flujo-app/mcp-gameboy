import { Worker } from 'node:worker_threads';
import { RomRepository } from './romRepository.js';
import { BUTTONS, type FrameResult, type GameBoyButton, type WorkerRequest, type WorkerResponse } from './types.js';

interface Job {
  request: WorkerRequest; resolve(value: FrameResult): void; reject(error: Error): void;
  romPath?: string; signal?: AbortSignal; abort?: () => void; timer?: ReturnType<typeof setTimeout>;
}
export interface EmulatorOptions { operationTimeoutMs?: number; loadTimeoutMs?: number; maxQueued?: number; }
export class EmulatorService {
  private worker?: Worker;
  private active?: Job;
  private queue: Job[] = [];
  private nextId = 1;
  private reads = 0;
  private closed = false;
  private snapshot?: FrameResult;
  private romPath?: string;
  constructor(readonly roms: RomRepository, private options: EmulatorOptions = {}) {}
  status() { return { available: !this.closed, romLoaded: !!this.snapshot, romPath: this.romPath ?? null, frames: this.snapshot?.frames ?? 0, pendingOperations: this.queue.length + (this.active ? 1 : 0) }; }
  getScreen(): FrameResult { if (!this.snapshot) throw new Error('No ROM loaded.'); return this.snapshot; }
  async loadRom(value: string, signal?: AbortSignal): Promise<FrameResult> {
    if (signal?.aborted) throw new Error('Operation cancelled.');
    if (this.reads >= 4) throw new Error('ROM read capacity reached.');
    this.reads++;
    try {
      const rom = await this.roms.read(value);
      return this.submit({ operation: 'load', rom: rom.data }, signal, rom.path);
    } finally { this.reads--; }
  }
  advance(frames: number, signal?: AbortSignal): Promise<FrameResult> {
    this.validateFrames(frames);
    return this.submit({ operation: 'advance', frames }, signal);
  }
  pressButton(button: GameBoyButton, frames: number, signal?: AbortSignal): Promise<FrameResult> {
    this.validateFrames(frames);
    if (!BUTTONS.includes(button)) return Promise.reject(new Error('Unknown button.'));
    return this.submit({ operation: 'press', frames, button }, signal);
  }
  private validateFrames(frames: number): void {
    if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new Error('Frames must be an integer from 1 to 600.');
  }
  private submit(request: Omit<WorkerRequest, 'id'>, signal?: AbortSignal, romPath?: string): Promise<FrameResult> {
    if (this.closed) return Promise.reject(new Error('Emulator is closed.'));
    if (signal?.aborted) return Promise.reject(new Error('Operation cancelled.'));
    if (this.queue.length >= (this.options.maxQueued ?? 16)) return Promise.reject(new Error('Emulator queue is full; retry after pending operations finish.'));
    return new Promise((resolve, reject) => {
      const job: Job = { request: { ...request, id: this.nextId++ }, resolve, reject, signal, romPath };
      job.abort = () => {
        if (this.active === job) this.reset(new Error('Operation cancelled; emulator reset. Reload the ROM before continuing.'));
        else { this.queue = this.queue.filter(item => item !== job); this.finish(job, new Error('Operation cancelled.')); }
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job); this.pump();
    });
  }
  private pump(): void {
    if (this.closed || this.active || !this.queue.length) return;
    if (!this.worker) {
      const worker = new Worker(new URL('./emulator-worker.js', import.meta.url), {
        stdout: true, stderr: true, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }
      });
      // Legacy emulator logs must never reach MCP stdout or grow an unbounded file.
      worker.stdout.resume(); worker.stderr.resume();
      worker.on('message', (response: WorkerResponse) => {
        if (this.worker !== worker || this.active?.request.id !== response.id) return;
        const job = this.active; this.active = undefined;
        if (response.error || !response.result) this.finish(job, new Error(response.error ?? 'Invalid worker response.'));
        else {
          this.snapshot = response.result;
          if (job.romPath) this.romPath = job.romPath;
          this.finish(job, undefined, response.result);
        }
        this.pump();
      });
      worker.on('error', () => { if (this.worker === worker) this.reset(new Error('Emulator worker failed; reload the ROM.')); });
      worker.on('exit', () => { if (this.worker === worker) this.reset(new Error('Emulator worker stopped; reload the ROM.')); });
      this.worker = worker;
    }
    const job = this.queue.shift()!; this.active = job;
    job.timer = setTimeout(() => this.reset(new Error('Emulator operation timed out and was stopped; reload the ROM.')),
      job.request.operation === 'load' ? (this.options.loadTimeoutMs ?? 5000) : (this.options.operationTimeoutMs ?? 2000));
    this.worker.postMessage(job.request);
  }
  private finish(job: Job, error?: Error, result?: FrameResult): void {
    clearTimeout(job.timer);
    if (job.abort) job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else job.resolve(result!);
  }
  private reset(error: Error): void {
    const worker = this.worker; this.worker = undefined;
    const jobs = [...(this.active ? [this.active] : []), ...this.queue];
    this.active = undefined; this.queue = []; this.snapshot = undefined; this.romPath = undefined;
    for (const job of jobs) this.finish(job, error);
    void worker?.terminate();
  }
  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.reset(new Error('Emulator closed.'));
    if (worker) await worker.terminate();
  }
}
