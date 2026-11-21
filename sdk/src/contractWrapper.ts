import { LumenFlowError, PaymentErrorCode } from './errors';

// Type-only imports are erased at compile time and never pull Stellar SDK XDR
// types into the initial bundle.
import type { ContractCallOptions as LazyContractCallOptions } from './contractWrapper';

export interface ContractCallOptions {
  rpcUrl: string;
  network?: string;
  method: string;
  params: Record<string, unknown>;
}

export interface ContractCallResponse<T = unknown> {
  result: T;
  error?: any;
}

export function normalizeContractError(error: unknown): LumenFlowError {
  if (error instanceof LumenFlowError) return error;

  if (typeof error === 'object' && error !== null) {
    const err = error as { code?: number; message?: string };
    if (typeof err.code === 'number' && err.code in PaymentErrorCode) {
      return new LumenFlowError(err.code as PaymentErrorCode, err.message || undefined);
    }
    if ('message' in err && typeof err.message === 'string') {
      return new LumenFlowError(PaymentErrorCode.InvalidInput, err.message);
    }
  }

  if (error instanceof Error) {
    return new LumenFlowError(PaymentErrorCode.InvalidInput, error.message);
  }

  return new LumenFlowError(PaymentErrorCode.InvalidInput, String(error));
}

export interface ContractWrapperModule {
  callContract: <T = unknown>(options: LazyContractCallOptions) => Promise<ContractCallResponse<T>>;
  normalizeContractError: (error: unknown) => LumenFlowError;
}

let contractWrapperPromise: Promise<ContractWrapperModule> | null = null;

/**
 * Lazily loads the contract wrapper module on first use and caches the
 * resulting promise so subsequent calls reuse the same module instance.
 *
 * The dynamic `import()` keeps Stellar SDK XDR types (and any other heavy
 * dependencies of the wrapper) out of the initial bundle for browser
 * consumers.
 */
export function getContractWrapper(): Promise<ContractWrapperModule> {
  if (!contractWrapperPromise) {
    contractWrapperPromise = import('./contractWrapper').then((mod) => ({
      callContract: mod.callContract as ContractWrapperModule['callContract'],
      normalizeContractError: mod.normalizeContractError,
    }));
  }
  return contractWrapperPromise;
}

export async function callContract<T = unknown>(options: ContractCallOptions): Promise<ContractCallResponse<T>> {
  if (!options.rpcUrl) throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'rpcUrl is required');
  if (!options.method) throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'method is required');
  if (!options.params || typeof options.params !== 'object') {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'params must be an object');
  }

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: options.method,
    params: options.params,
  };

  let response: Response;
  try {
    response = await fetch(options.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw normalizeContractError(err);
  }

  let parsed: any;
  try {
    parsed = await response.json();
  } catch (err) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'Invalid JSON response from contract RPC');
  }

  if (parsed.error) {
    throw normalizeContractError(parsed.error);
  }

  if (!('result' in parsed)) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'RPC response missing result field');
  }

  return { result: parsed.result };
}
