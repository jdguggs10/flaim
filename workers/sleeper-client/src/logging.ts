import { logEvalEvent as sharedLogEvalEvent, type TraceLogEvent as SharedTraceLogEvent } from '@flaim/worker-shared';

export type TraceLogEvent = Omit<SharedTraceLogEvent, 'service' | 'phase'> & {
  service: 'sleeper-client';
  phase: 'execute_start' | 'execute_end' | 'execute_error';
};

export function logEvalEvent(event: TraceLogEvent): void {
  sharedLogEvalEvent(event);
}
