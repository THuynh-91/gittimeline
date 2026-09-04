import { compilePerformance, type ProgressStage } from '@/choreography/compile';
import type { CompiledPerformance, CompileOptions, Dataset } from '@/model/types';

/**
 * Analysis/layout/choreography worker. Receives a normalized dataset, returns
 * the compiled plan. Geometry buffers are transferred, not cloned.
 */
export interface CompileRequest {
  kind: 'compile';
  runId: number;
  dataset: Dataset;
  options: CompileOptions;
}

export type CompileResponse =
  | { kind: 'progress'; runId: number; stage: ProgressStage; detail?: string }
  | { kind: 'done'; runId: number; performance: CompiledPerformance }
  | { kind: 'error'; runId: number; message: string };

self.onmessage = (ev: MessageEvent<CompileRequest>) => {
  const msg = ev.data;
  if (!msg || msg.kind !== 'compile') return;
  try {
    const performance = compilePerformance(msg.dataset, msg.options, (stage, detail) => {
      const progress: CompileResponse = { kind: 'progress', runId: msg.runId, stage, detail };
      self.postMessage(progress);
    });
    const transfer: ArrayBuffer[] = [];
    for (const e of performance.edges) transfer.push(e.pts.buffer as ArrayBuffer);
    transfer.push(performance.waveform.buffer as ArrayBuffer);
    const done: CompileResponse = { kind: 'done', runId: msg.runId, performance };
    self.postMessage(done, transfer);
  } catch (err) {
    const error: CompileResponse = { kind: 'error', runId: msg.runId, message: err instanceof Error ? err.message : String(err) };
    self.postMessage(error);
  }
};
