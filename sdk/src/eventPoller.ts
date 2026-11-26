import { LumenFlowError, NetworkError, PaymentErrorCode, RateLimitError } from './errors';
import { EventCompatError, parseLumenFlowEvent } from './eventCatalog';
import { LogLevel, StructuredLogger, resolveCorrelationId } from './logging';
import { redactSensitive } from './logRedaction';

export interface ContractEvent {
  id: string;
  type: string;
  contractId: string;
  ledger: number;
  topic: string[];
  value: unknown;
}

export interface EventPollerTlsOptions {
  /** PEM-encoded CA certificate(s) used to verify the internal RPC endpoint. */
  ca?: string | Buffer | Array<string | Buffer>;
  /** PEM-encoded client certificate presented for mutual TLS. */
  cert?: string | Buffer;
  /** PEM-encoded private key for the client certificate. */
  key?: string | Buffer;
  /** Reject unauthorized server certificates. Defaults to true. */
  rejectUnauthorized?: boolean;
}

export interface EventPollerOptions {
  rpcUrl: string;
  contractId: string;
  eventTypes?: string[];
  fromLedger?: number;
  strict?: boolean;
  correlationId?: string;
  logLevel?: LogLevel;
}

function createLogger(options: EventPollerOptions): StructuredLogger {
  return new StructuredLogger({
    level: options.logLevel,
    correlationId: resolveCorrelationId(options.correlationId),
  });
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

export interface RpcFilter {
  type: 'contract';
  contractIds: string[];
  topics?: string[][];
}

interface RpcRequestPayload {
  jsonrpc: '2.0';
  id: number;
  method: 'getEvents';
  params: {
    startLedger: number;
    filters: RpcFilter[];
  };
}

interface RpcErrorObject {
  code?: number;
  message?: string;
}

interface RpcSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    events?: unknown[];
  };
}

interface RpcErrorResponse {
  jsonrpc: '2.0';
  id: number;
  error: RpcErrorObject;
}

type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

function isRpcErrorResponse(data: RpcResponse): data is RpcErrorResponse {
  return typeof (data as RpcErrorResponse).error === 'object' && (data as RpcErrorResponse).error !== null;
}

function buildRpcPayload(options: EventPollerOptions): RpcRequestPayload {
  const filters: RpcFilter[] = [
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
  const logger = createLogger(options);
  const startedAt = Date.now();
  const operation = 'fetchContractEvents';

  try {
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
        logger.warn('Discarding invalid contract event', {
          operation,
          error: redactSensitive(error),
        });
      }
    }

    logger.info('Fetched contract events', {
      operation,
      duration_ms: Date.now() - startedAt,
      contractId: options.contractId,
      eventCount: validEvents.length,
    });
    return validEvents;
  } catch (error) {
    logger.error('Failed to fetch contract events', {
      operation,
      duration_ms: Date.now() - startedAt,
      contractId: options.contractId,
      error: redactSensitive(error),
    });
    throw error;
  }
}

export function pollContractEvents(
  options: EventPollerOptions,
  intervalMs: number,
  callback: (events: ContractEvent[]) => void,
): () => void {
  const logger = createLogger(options);
  const operation = 'pollContractEvents';

  const timer = setInterval(() => {
    const startedAt = Date.now();
    fetchContractEvents(options)
      .then((events) => {
        callback(events);
        logger.debug('Poll cycle completed', {
          operation,
          duration_ms: Date.now() - startedAt,
          eventCount: events.length,
        });
      })
      .catch((error) => {
        logger.error('Poll cycle failed', {
          operation,
          duration_ms: Date.now() - startedAt,
          error: redactSensitive(error),
        });
      });
  }, intervalMs);

  return () => clearInterval(timer);
}
