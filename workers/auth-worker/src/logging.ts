import { logEvalEvent as sharedLogEvalEvent, type TraceLogEvent as SharedTraceLogEvent } from '@flaim/worker-shared';

export type TraceLogEvent = Omit<SharedTraceLogEvent, 'service' | 'phase'> & {
  service: 'auth-worker';
  phase: 'request_start' | 'request_end' | 'request_error';
};

export function logEvalEvent(event: TraceLogEvent): void {
  sharedLogEvalEvent(event);
}
