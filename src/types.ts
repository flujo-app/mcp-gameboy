export const BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT'] as const;
export type GameBoyButton = typeof BUTTONS[number];
export interface FrameResult { png: string; frames: number; }
export interface WorkerRequest { id: number; operation: 'load' | 'advance' | 'press'; rom?: Uint8Array; frames?: number; button?: GameBoyButton; }
export interface WorkerResponse { id: number; result?: FrameResult; error?: string; }
