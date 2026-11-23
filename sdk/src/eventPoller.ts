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
  /** mTLS configuration for internal service-to-service calls. */
  tls?: EventPollerTlsOptions;
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateTlsOptions(options: EventPollerOptions): void {
  const tls = options.tls;
  if (!tls) return;

  if (!isHttpsUrl(options.rpcUrl)) {
    throw new LumenFlowError(
      PaymentErrorCode.InvalidInput,
      'mTLS options require an https rpcUrl',
    );
  }
  if (!tls.cert || !tls.key) {
    throw new LumenFlowError(
      PaymentErrorCode.InvalidInput,
      'mTLS requires both client certificate (tls.cert) and private key (tls.key)',
    );
  }
}

async function buildDispatcher(options: EventPollerOptions): Promise<any> {
  if (!options.tls) return undefined;

  let undici: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    undici = require('undici');
  } catch {
    throw new LumenFlowError(
      PaymentErrorCode.InvalidInput,
      'mTLS requires the "undici" package to be installed',
    );
  }

  const agent = new undici.Agent({
    connect: {
      ca: options.tls.ca,
      cert: options.tls.cert,
      key: options.tls.key,
      rejectUnauthorized: options.tls.rejectUnauthorized ?? true,
    },
  });

  return new undici.Dispatcher ? agent : agent;
}

function isTlsHandshakeError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  const message = String((err as { message?: string } | undefined)?.message ?? err);
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA' ||
    /certificate|tls|ssl/i.test(message)
  );
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

  validateTlsOptions(options);
  const dispatcher = await buildDispatcher(options);

  let response: Response;
  try {
    response = await fetch(options.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRpcPayload(options)),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
  } catch (err) {
    if (options.tls && isTlsHandshakeError(err)) {
      throw new LumenFlowError(
        PaymentErrorCode.InvalidInput,
        `mTLS handshake with RPC endpoint failed: ${String(
          (err as { message?: string } | undefined)?.message ?? err,
        )}`,
      );
    }
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
