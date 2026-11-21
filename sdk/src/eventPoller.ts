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
}

/**
 * Event types the poller subscribes to by default. Includes the escrow expiry
 * warning so off-chain consumers receive it as a webhook event before the
 * escrow auto-cancels.
 */
export const DEFAULT_EVENT_TYPES: string[] = [
  'escrow_created',
  'escrow_released',
  'escrow_cancelled',
  'escrow_expiry_warning',
];

/** Maps a contract event topic to the webhook event type delivered off-chain. */
export function toWebhookEventType(event: ContractEvent): string {
  const topic = event.topic[0];
  if (typeof topic === 'string' && topic.length > 0) {
    return topic;
  }
  return 'unknown';
}

/** Returns true when the event is an escrow expiry warning. */
export function isEscrowExpiryWarning(event: ContractEvent): boolean {
  return toWebhookEventType(event) === 'escrow_expiry_warning';
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
      topics: [options.eventTypes ?? DEFAULT_EVENT_TYPES],
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

  let response: Response;
  try {
    response = await fetch(options.rpcUrl, {
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
  const timer = setInterval(() => {
    fetchContractEvents(options)
      .then(callback)
      .catch(() => {});
  }, intervalMs);

  return () => clearInterval(timer);
}

export interface WebhookEvent {
  type: string;
  eventId: string;
  contractId: string;
  ledger: number;
  payload: unknown;
}

/** Converts a contract event into the webhook event shape delivered off-chain. */
export function toWebhookEvent(event: ContractEvent): WebhookEvent {
  return {
    type: toWebhookEventType(event),
    eventId: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    payload: event.value,
  };
}

/**
 * Polls contract events and forwards them as webhook events. Escrow expiry
 * warnings are surfaced with type `escrow_expiry_warning` so consumers can
 * release funds proactively before auto-cancellation.
 */
export function pollWebhookEvents(
  options: EventPollerOptions,
  intervalMs: number,
  callback: (events: WebhookEvent[]) => void,
): () => void {
  return pollContractEvents(options, intervalMs, (events) => {
    callback(events.map(toWebhookEvent));
  });
}
