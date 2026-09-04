import type { CompiledPerformance, CompileOptions, Dataset } from '@/model/types';
import type { CompileRequest, CompileResponse } from '@/workers/compile.worker';
import type { ProgressStage } from '@/choreography/compile';

/**
 * Compiles in a Web Worker when available, otherwise on the main thread
 * (tests, very old browsers). Each request carries a run id so a late
 * result from a cancelled run can never mutate current state.
 */
export interface CompileHandle {
  promise: Promise<CompiledPerformance>;
  cancel: () => void;
}

let worker: Worker | null = null;
let nextRunId = 1;
const pending = new Map<number, { resolve: (p: CompiledPerformance) => void; reject: (e: Error) => void; onProgress?: (stage: ProgressStage, detail?: string) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/compile.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (ev: MessageEvent<CompileResponse>) => {
    const msg = ev.data;
    const entry = pending.get(msg.runId);
    if (!entry) return;
    if (msg.kind === 'progress') entry.onProgress?.(msg.stage, msg.detail);
    else if (msg.kind === 'done') {
      pending.delete(msg.runId);
      entry.resolve(msg.performance);
    } else {
      pending.delete(msg.runId);
      entry.reject(new Error(msg.message));
    }
  };
  worker.onerror = (ev) => {
    for (const [id, entry] of pending) {
      entry.reject(new Error(ev.message || 'Compile worker failed'));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function compileInWorker(dataset: Dataset, options: CompileOptions, onProgress?: (stage: ProgressStage, detail?: string) => void): CompileHandle {
  const runId = nextRunId++;
  const w = getWorker();
  if (!w) {
    const promise = import('@/choreography/compile').then(({ compilePerformance }) => compilePerformance(dataset, options, onProgress));
    return { promise, cancel: () => {} };
  }
  const promise = new Promise<CompiledPerformance>((resolve, reject) => {
    pending.set(runId, { resolve, reject, onProgress });
    const req: CompileRequest = { kind: 'compile', runId, dataset, options };
    w.postMessage(req);
  });
  return {
    promise,
    cancel: () => {
      const entry = pending.get(runId);
      if (entry) {
        pending.delete(runId);
        entry.reject(new Error('cancelled'));
      }
    },
  };
}
