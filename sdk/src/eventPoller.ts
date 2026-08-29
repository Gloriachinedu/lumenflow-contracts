import { LumenFlowError, PaymentErrorCode } from './errors';

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
  return events.map((event: any) => ({
    id: event.id,
    type: event.type,
    contractId: event.contractId,
    ledger: event.ledger,
    topic: event.topic ?? [],
    value: event.value,
  }));
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
