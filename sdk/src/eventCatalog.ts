/**
 * LumenFlow SDK — canonical contract-event catalog.
 *
 * This is the SDK's machine-readable description of the Soroban events emitted
 * by the LumenFlow contract: the event name (`topic[1]`), whether the merchant
 * address is carried as a filterable `topic[2]`, and the ordered names of the
 * fields in the data tuple.
 *
 * It mirrors `docs/events-reference.md` / `docs/webhook-integration.md` and is
 * kept honest by `src/tests/contractEventCompat.test.ts`, which diffs it against
 * the actual `env.events().publish(...)` calls in the Rust contract.
 *
 * Consumers use it to decode a raw Horizon / RPC event into a named, typed
 * shape without hard-coding topic offsets everywhere.
 */

export type EventFieldType = 'string' | 'address' | 'i128' | 'u32' | 'u64' | 'symbol' | 'bytes';

export interface CatalogEntry {
  /** Event name — the second topic. */
  name: string;
  /**
   * When true the contract emits the merchant address as `topic[2]`, so it can
   * be filtered server-side via Horizon `topic3` / RPC `topics[2]`.
   */
  merchantFilterable: boolean;
  /** Ordered field names of the data tuple. */
  data: string[];
  /** Field types, parallel to {@link data}. */
  types: EventFieldType[];
}

function entry(
  name: string,
  merchantFilterable: boolean,
  fields: Array<[string, EventFieldType]>,
): CatalogEntry {
  return {
    name,
    merchantFilterable,
    data: fields.map((f) => f[0]),
    types: fields.map((f) => f[1]),
  };
}

/**
 * The integration surface — the events off-chain consumers (webhooks, indexers,
 * the SDK event stream) are expected to handle. Purely-internal admin telemetry
 * events emitted by the contract are intentionally out of scope here; the compat
 * test enforces that every entry below is really emitted, not the reverse.
 */
export const EVENT_CATALOG: readonly CatalogEntry[] = [
  entry('payment_processed', true, [
    ['order_id', 'string'],
    ['payer', 'address'],
    ['amount', 'i128'],
  ]),
  entry('refund_initiated', true, [
    ['refund_id', 'string'],
    ['order_id', 'string'],
  ]),
  entry('refund_approved', true, [
    ['refund_id', 'string'],
    ['order_id', 'string'],
  ]),
  entry('refund_rejected', true, [
    ['refund_id', 'string'],
    ['order_id', 'string'],
  ]),
  entry('refund_executed', true, [
    ['refund_id', 'string'],
    ['order_id', 'string'],
  ]),
  entry('dispute_raised', false, [
    ['dispute_id', 'string'],
    ['refund_id', 'string'],
    ['order_id', 'string'],
  ]),
  entry('dispute_resolved', false, [
    ['dispute_id', 'string'],
    ['resolution', 'string'],
    ['force_refund', 'symbol'],
  ]),
  entry('multisig_initiated', false, [['payment_id', 'string']]),
  entry('multisig_executed', false, [['payment_id', 'string']]),
  entry('merchant_registered', false, [['merchant_address', 'address']]),
  entry('merchant_updated', false, [['merchant_address', 'address']]),
  entry('merchant_verified', false, [['merchant_address', 'address']]),
  entry('merchant_unverified', false, [['merchant_address', 'address']]),
  entry('merchant_deactivated', false, [['merchant_address', 'address']]),
  entry('merchant_reactivated', false, [['merchant_address', 'address']]),
  entry('payment_archived', false, [['order_id', 'string']]),
  entry('payment_request_paid', false, [['request_id', 'string']]),
  entry('subscription_created', false, [
    ['subscription_id', 'string'],
    ['subscriber', 'address'],
    ['merchant', 'address'],
  ]),
  entry('subscription_charged', false, [
    ['subscription_id', 'string'],
    ['cycles_charged', 'u32'],
    ['amount', 'i128'],
  ]),
  entry('subscription_cancelled', false, [
    ['subscription_id', 'string'],
    ['caller', 'address'],
  ]),
  entry('subscription_plan_created', false, [['plan_id', 'string']]),
  entry('contract_paused', false, []),
  entry('contract_unpaused', false, []),
  entry('contract_upgraded', false, [['new_wasm_hash', 'bytes']]),
] as const;

const BY_NAME = new Map(EVENT_CATALOG.map((e) => [e.name, e]));

export function getCatalogEntry(name: string): CatalogEntry | undefined {
  return BY_NAME.get(name);
}

export function isKnownEvent(name: string): boolean {
  return BY_NAME.has(name);
}

/** A raw contract event as delivered by Horizon SSE or Soroban RPC `getEvents`. */
export interface RawContractEvent {
  /** Topic array. `topic[0]` must be `"lumenflow"`, `topic[1]` the event name. */
  topic?: string[];
  /** Decoded data payload — a scalar, or a tuple as an array. */
  value?: unknown;
}

export interface ParsedEvent {
  name: string;
  /** Present only for merchant-filterable events. */
  merchant?: string;
  /** Data tuple keyed by the catalog field names. */
  data: Record<string, unknown>;
}

export class EventCompatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventCompatError';
  }
}

/**
 * Decode a raw contract event into a named, keyed shape using the catalog.
 *
 * @throws {EventCompatError} when the topic is malformed, the event name is not
 *         in the catalog, or the data tuple arity does not match the catalog.
 */
export function parseLumenFlowEvent(raw: RawContractEvent): ParsedEvent {
  const topic = raw.topic ?? [];
  if (topic[0] !== 'lumenflow') {
    throw new EventCompatError(`not a LumenFlow event: topic[0] is ${JSON.stringify(topic[0])}`);
  }
  const name = topic[1];
  if (!name) {
    throw new EventCompatError('event name (topic[1]) is missing');
  }
  const spec = BY_NAME.get(name);
  if (!spec) {
    throw new EventCompatError(`unknown event '${name}' — not in the SDK catalog`);
  }

  const merchant = spec.merchantFilterable ? topic[2] : undefined;
  if (spec.merchantFilterable && !merchant) {
    throw new EventCompatError(`event '${name}' is merchant-filterable but topic[2] is missing`);
  }

  const tuple = normaliseTuple(raw.value, spec.data.length);
  if (tuple.length !== spec.data.length) {
    throw new EventCompatError(
      `event '${name}' expected ${spec.data.length} data field(s), got ${tuple.length}`,
    );
  }

  const data: Record<string, unknown> = {};
  spec.data.forEach((field, i) => {
    data[field] = tuple[i];
  });

  return merchant ? { name, merchant, data } : { name, data };
}

/** Coerce a scalar / array / undefined data payload into a positional array. */
function normaliseTuple(value: unknown, expectedLen: number): unknown[] {
  if (expectedLen === 0) return [];
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}
