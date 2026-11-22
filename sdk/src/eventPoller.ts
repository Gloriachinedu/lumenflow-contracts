import { LumenFlowError, PaymentErrorCode } from './errors';
import { EventCompatError, parseLumenFlowEvent } from './eventCatalog';

export interface ContractEvent {
  id: string;
  type: string;
  contractId: string;
  ledger: number;
  topic: string[];
  value: unknown;
}

export interface EventPollerOptions {
  rpcUrl: string;
  contractId: string;
  eventTypes?: string[];
  fromLedger?: number;
  strict?: boolean;
  /** Optional fetch implementation, primarily for chaos/testing injection. */
  fetchImpl?: typeof fetch;
  /** Optional callback invoked when a poll cycle fails (e.g. during an RPC outage). */
  onError?: (error: unknown) => void;
  /** Optional callback invoked when polling recovers after one or more failures. */
  onRecover?: (events: ContractEvent[]) => void;
}

function validateEvent(event: unknown): ContractEvent {
  if (!event || typeof event !== 'object') {
    throw new EventCompatError('event payload is not an object');
  }

  const candidate = event as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id) {
    throw new EventCompatError('event id is missing');
  }
  if (candidate.type !== 'contract') {
    throw new EventCompatError('event type must be contract');
  }
  if (typeof candidate.contractId !== 'string' || !candidate.contractId) {
    throw new EventCompatError('event contractId is missing');
  }
  if (!Number.isSafeInteger(candidate.ledger) || (candidate.ledger as number) < 0) {
    throw new EventCompatError('event ledger must be a non-negative integer');
  }
  if (!Array.isArray(candidate.topic) || candidate.topic.some((topic) => typeof topic !== 'string')) {
    throw new EventCompatError('event topic must be an array of strings');
  }

  parseLumenFlowEvent({ topic: candidate.topic, value: candidate.value });
  return {
    id: candidate.id,
    type: candidate.type,
    contractId: candidate.contractId,
    ledger: candidate.ledger as number,
    topic: candidate.topic,
    value: candidate.value,
  };
}

function buildRpcPayload(options: EventPollerOptions) {
  const filters: any[] = [
    {
      type: 'contract',
      contractIds: [options.contractId],
      topics: options.eventTypes ? [options.eventTypes] : undefined,
    },
  ];

  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'getEvents',
    params: {
      startLedger: options.fromLedger ?? 0,
      filters,
    },
  };
}

export async function fetchContractEvents(options: EventPollerOptions): Promise<ContractEvent[]> {
  if (!options.rpcUrl) throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'rpcUrl is required');
  if (!options.contractId) throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'contractId is required');

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRpcPayload(options)),
    });
  } catch (err) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, String(err));
  }

  let data: any;
  try {
    data = await response.json();
  } catch (err) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'Invalid JSON response from RPC');
  }

  if (data.error) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, data.error.message ?? JSON.stringify(data.error));
  }

  const events = data.result?.events ?? [];
  const validEvents: ContractEvent[] = [];
  for (const event of events) {
    try {
      validEvents.push(validateEvent(event));
    } catch (error) {
      if (options.strict) throw error;
      console.warn('[LumenFlow] Discarding invalid contract event', error);
    }
  }
  return validEvents;
}

export function pollContractEvents(
  options: EventPollerOptions,
  intervalMs: number,
  callback: (events: ContractEvent[]) => void,
): () => void {
  let stopped = false;
  let inFlight = false;
  let failing = false;

  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    fetchContractEvents(options)
      .then((events) => {
        if (stopped) return;
        if (failing) {
          failing = false;
          options.onRecover?.(events);
        }
        callback(events);
      })
      .catch((error) => {
        if (stopped) return;
        failing = true;
        options.onError?.(error);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
