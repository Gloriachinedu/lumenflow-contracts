/**
 * Contract-to-SDK event compatibility tests (issue #879).
 *
 * These guard the seam between the Rust contract's `env.events().publish(...)`
 * calls and the SDK's understanding of those events:
 *
 *   - `src/eventCatalog.ts`        — the SDK's machine-readable event catalog
 *   - `src/events.ts::subscribe`   — the Horizon SSE filter (`topic[1]`)
 *   - `docs/webhook-integration.md` / `docs/events-reference.md` — the docs
 *
 * The suite parses the actual contract source and fails if the catalog claims
 * an event the contract never emits, if merchant-filterability disagrees, if
 * the SSE filter can't match a catalogued event, or if the webhook doc table
 * drifts from the catalog. It also exercises the decode path for unknown /
 * malformed events.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  EVENT_CATALOG,
  getCatalogEntry,
  isKnownEvent,
  parseLumenFlowEvent,
  EventCompatError,
} from '../eventCatalog';
import { subscribe, LumenFlowEvent } from '../events';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CONTRACT_SRC_DIR = path.join(REPO_ROOT, 'contracts/lumenflow/src');

/** Read every non-test `.rs` file in the contract crate and concatenate. */
function contractSource(): string {
  return fs
    .readdirSync(CONTRACT_SRC_DIR)
    .filter((f) => f.endsWith('.rs') && !/test/.test(f))
    .map((f) => fs.readFileSync(path.join(CONTRACT_SRC_DIR, f), 'utf8'))
    .join('\n');
}

/**
 * Extract every LumenFlow event the contract emits, mapping name → whether a
 * third topic element (the merchant address) is present.
 *
 * Matches `("lumenflow", "<name>"` followed by either `,` (has topic[2]) or
 * `)` (2-topic event), tolerating whitespace / newlines.
 */
function emittedEvents(src: string): Map<string, { merchantTopic: boolean }> {
  const re = /\(\s*"lumenflow"\s*,\s*"([a-z_]+)"\s*([,)])/g;
  const out = new Map<string, { merchantTopic: boolean }>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.set(m[1], { merchantTopic: m[2] === ',' });
  }
  return out;
}

const SRC = contractSource();
const EMITTED = emittedEvents(SRC);

// ─── Catalog ⊆ contract ───────────────────────────────────────────────────────

describe('event catalog vs. contract emissions', () => {
  it('the contract source parsed to a non-empty event set (sanity)', () => {
    expect(EMITTED.size).toBeGreaterThan(10);
    expect(EMITTED.has('payment_processed')).toBe(true);
  });

  it.each(EVENT_CATALOG.map((e) => e.name))(
    'catalogued event "%s" is actually emitted by the contract',
    (name) => {
      expect(EMITTED.has(name)).toBe(true);
    },
  );

  it.each(EVENT_CATALOG.filter((e) => e.merchantFilterable).map((e) => e.name))(
    'catalogued merchant-filterable event "%s" emits the merchant as topic[2]',
    (name) => {
      expect(EMITTED.get(name)?.merchantTopic).toBe(true);
    },
  );

  it.each(EVENT_CATALOG.filter((e) => !e.merchantFilterable).map((e) => e.name))(
    'catalogued non-filterable event "%s" is a 2-topic event on-chain',
    (name) => {
      expect(EMITTED.get(name)?.merchantTopic).toBe(false);
    },
  );

  it('has no duplicate catalog entries', () => {
    const names = EVENT_CATALOG.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps data / types arrays the same length for every entry', () => {
    for (const e of EVENT_CATALOG) {
      expect(e.types).toHaveLength(e.data.length);
    }
  });
});

// ─── Docs ⇄ catalog ───────────────────────────────────────────────────────────

describe('webhook-integration.md event table vs. catalog', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs/webhook-integration.md'), 'utf8');
  // Rows look like: | `payment_processed` | `payment_processed` | `merchant_address` ✦ | ... |
  const rowRe = /^\|\s*`([a-z_]+)`\s*\|\s*`([a-z_]+)`\s*\|\s*([^|]*)\|/gm;
  const rows: Array<{ event: string; topic1: string; topic2: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(doc)) !== null) {
    rows.push({ event: m[1], topic1: m[2], topic2: m[3].trim() });
  }

  it('parsed at least the payment + refund rows from the doc', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it.each(['payment_processed', 'refund_initiated', 'refund_approved', 'refund_rejected', 'refund_executed'])(
    'doc row "%s" is present in the SDK catalog',
    (event) => {
      expect(isKnownEvent(event)).toBe(true);
    },
  );

  it('every doc row that carries a merchant topic[2] is flagged merchantFilterable in the catalog', () => {
    for (const row of rows) {
      const entry = getCatalogEntry(row.event);
      if (!entry) continue; // doc may list internal events the catalog omits
      const docSaysMerchant = row.topic2.includes('merchant_address');
      if (docSaysMerchant) {
        expect(entry.merchantFilterable).toBe(true);
      }
    }
  });
});

// ─── SSE subscribe() filter ⇄ catalog ─────────────────────────────────────────

describe('events.subscribe() filter matches catalogued event names', () => {
  class MockEventSource {
    static instances: MockEventSource[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      MockEventSource.instances.push(this);
    }
    emit(data: object) {
      this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }
    close() {}
  }

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as any).EventSource = MockEventSource;
  });

  it.each(EVENT_CATALOG.map((e) => e.name))(
    'subscribe({ eventName: "%s" }) receives a matching event and rejects others',
    (name) => {
      const received: LumenFlowEvent[] = [];
      const unsub = subscribe('CONTRACT_ID', { eventName: name }, (e) => received.push(e));
      const es = MockEventSource.instances[0];

      es.emit({ id: '1', type: 'contract', topic: ['lumenflow', name], value: '{}' });
      es.emit({ id: '2', type: 'contract', topic: ['lumenflow', 'some_other_event'], value: '{}' });

      expect(received).toHaveLength(1);
      expect(received[0].topics[1]).toBe(name);
      unsub();
    },
  );
});

// ─── Decode path: happy + failure/edge ────────────────────────────────────────

describe('parseLumenFlowEvent — catalogued shapes', () => {
  it('decodes a merchant-filterable payment_processed event', () => {
    const parsed = parseLumenFlowEvent({
      topic: ['lumenflow', 'payment_processed', 'GMERCHANT'],
      value: ['ORDER-1', 'GPAYER', 1000n],
    });
    expect(parsed).toEqual({
      name: 'payment_processed',
      merchant: 'GMERCHANT',
      data: { order_id: 'ORDER-1', payer: 'GPAYER', amount: 1000n },
    });
  });

  it('decodes a 2-field refund event', () => {
    const parsed = parseLumenFlowEvent({
      topic: ['lumenflow', 'refund_executed', 'GMERCHANT'],
      value: ['RF-1', 'ORDER-1'],
    });
    expect(parsed.data).toEqual({ refund_id: 'RF-1', order_id: 'ORDER-1' });
  });

  it('decodes a scalar-payload event (payment_archived)', () => {
    const parsed = parseLumenFlowEvent({ topic: ['lumenflow', 'payment_archived'], value: 'ORDER-9' });
    expect(parsed.data).toEqual({ order_id: 'ORDER-9' });
    expect(parsed.merchant).toBeUndefined();
  });

  it('decodes a no-data event (contract_paused)', () => {
    const parsed = parseLumenFlowEvent({ topic: ['lumenflow', 'contract_paused'], value: undefined });
    expect(parsed).toEqual({ name: 'contract_paused', data: {} });
  });
});

describe('parseLumenFlowEvent — failure and boundary cases', () => {
  it('rejects an event whose topic[0] is not "lumenflow"', () => {
    expect(() => parseLumenFlowEvent({ topic: ['stellar', 'payment_processed'] })).toThrow(EventCompatError);
  });

  it('rejects an event with a missing name', () => {
    expect(() => parseLumenFlowEvent({ topic: ['lumenflow'] })).toThrow(/name .* missing/);
  });

  it('rejects an event that is not in the catalog', () => {
    expect(() => parseLumenFlowEvent({ topic: ['lumenflow', 'brand_new_event'], value: [] })).toThrow(
      /unknown event 'brand_new_event'/,
    );
  });

  it('rejects a merchant-filterable event missing topic[2]', () => {
    expect(() =>
      parseLumenFlowEvent({ topic: ['lumenflow', 'payment_processed'], value: ['O', 'P', 1n] }),
    ).toThrow(/topic\[2\] is missing/);
  });

  it('rejects a data tuple with the wrong arity', () => {
    expect(() =>
      parseLumenFlowEvent({
        topic: ['lumenflow', 'payment_processed', 'GMERCHANT'],
        value: ['ORDER-1', 'GPAYER'], // missing amount
      }),
    ).toThrow(/expected 3 data field\(s\), got 2/);
  });

  it('isKnownEvent / getCatalogEntry agree with the catalog', () => {
    expect(isKnownEvent('refund_approved')).toBe(true);
    expect(isKnownEvent('not_an_event')).toBe(false);
    expect(getCatalogEntry('refund_approved')?.merchantFilterable).toBe(true);
    expect(getCatalogEntry('not_an_event')).toBeUndefined();
  });
});
