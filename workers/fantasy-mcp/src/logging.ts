import { logEvalEvent as sharedLogEvalEvent, type TraceLogEvent as SharedTraceLogEvent } from '@flaim/worker-shared';

export type TraceLogEvent = Omit<SharedTraceLogEvent, 'service' | 'phase'> & {
  service: 'fantasy-mcp';
  phase: 'request_start' | 'request_end' | 'tool_start' | 'tool_end' | 'tool_error';
};

export function logEvalEvent(event: TraceLogEvent): void {
  sharedLogEvalEvent(event);
}
