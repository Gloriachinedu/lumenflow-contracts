import {
  LumenFlowError,
  ERROR_MESSAGES,
  PaymentErrorCode,
} from '../errors';
import { normalizeContractError } from '../contractWrapper';

// Numeric members of the PaymentErrorCode enum (drop the reverse string keys).
const NUMERIC_CODES = Object.values(PaymentErrorCode).filter(
  (v): v is number => typeof v === 'number',
);

describe('ERROR_MESSAGES catalogue', () => {
  it('defines a non-empty message for every PaymentErrorCode', () => {
    for (const code of NUMERIC_CODES) {
      const message = ERROR_MESSAGES[code as PaymentErrorCode];
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('has no entries for codes that are not in the enum', () => {
    const known = new Set(NUMERIC_CODES);
    for (const key of Object.keys(ERROR_MESSAGES)) {
      expect(known.has(Number(key))).toBe(true);
    }
  });
});

describe('LumenFlowError code mapping', () => {
  it('maps a known code to its catalogue message', () => {
    const err = new LumenFlowError(PaymentErrorCode.MerchantNotFound);
    expect(err.message).toBe(ERROR_MESSAGES[PaymentErrorCode.MerchantNotFound]);
    expect(err.code).toBe(PaymentErrorCode.MerchantNotFound);
    expect(err.name).toBe('LumenFlowError');
    expect(err).toBeInstanceOf(Error);
  });

  it('keeps the catalogue message and stores extra context in details', () => {
    const err = new LumenFlowError(PaymentErrorCode.InvalidInput, 'orderId must be a non-empty string');
    expect(err.message).toBe(ERROR_MESSAGES[PaymentErrorCode.InvalidInput]);
    expect(err.details).toBe('orderId must be a non-empty string');
  });

  it('falls back gracefully for an unknown code', () => {
    const err = new LumenFlowError(4242 as PaymentErrorCode);
    expect(err.message).toBe('An unknown error occurred (code: 4242)');
    expect(err.code).toBe(4242);
    expect(err.codeName).toBe('Unknown');
    expect(err.messageKey).toBe('error.unknown');
  });

  it('derives codeName and messageKey from the enum for known codes', () => {
    const err = new LumenFlowError(PaymentErrorCode.InvalidSignature);
    expect(err.codeName).toBe('InvalidSignature');
    expect(err.messageKey).toBe('error.invalidsignature');
  });
});

describe('LumenFlowError serialization', () => {
  it('toJSON produces a stable, JSON-safe shape', () => {
    const err = new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists, { orderId: 'A1' });
    expect(err.toJSON()).toEqual({
      name: 'LumenFlowError',
      code: PaymentErrorCode.PaymentAlreadyExists,
      codeName: 'PaymentAlreadyExists',
      message: ERROR_MESSAGES[PaymentErrorCode.PaymentAlreadyExists],
      messageKey: 'error.paymentalreadyexists',
      details: { orderId: 'A1' },
    });
  });

  it('omits the details key entirely when there are no details', () => {
    const json = new LumenFlowError(PaymentErrorCode.Unauthorized).toJSON();
    expect(json).not.toHaveProperty('details');
    expect(Object.keys(json)).toEqual(['name', 'code', 'codeName', 'message', 'messageKey']);
  });

  it('round-trips through JSON.stringify / JSON.parse', () => {
    const err = new LumenFlowError(PaymentErrorCode.RefundWindowExpired, ['ctx']);
    const revived = JSON.parse(JSON.stringify(err));
    expect(revived).toEqual(err.toJSON());
    // A plain Error would serialize to "{}" — assert we are better than that.
    expect(JSON.stringify(err)).not.toBe('{}');
  });

  it('serializes an unknown code without throwing', () => {
    const err = new LumenFlowError(999 as PaymentErrorCode);
    expect(() => JSON.stringify(err)).not.toThrow();
    expect(err.toJSON().codeName).toBe('Unknown');
    expect(err.toJSON().messageKey).toBe('error.unknown');
  });
});

describe('normalizeContractError', () => {
  it('returns an existing LumenFlowError unchanged (identity)', () => {
    const original = new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists, 'dup');
    expect(normalizeContractError(original)).toBe(original);
  });

  it('maps a contract error object with a known numeric code', () => {
    const err = normalizeContractError({ code: 21, message: 'duplicate order' });
    expect(err).toBeInstanceOf(LumenFlowError);
    expect(err.code).toBe(PaymentErrorCode.PaymentAlreadyExists);
    expect(err.message).toBe(ERROR_MESSAGES[PaymentErrorCode.PaymentAlreadyExists]);
    expect(err.details).toBe('duplicate order');
  });

  it('maps a known numeric code even without a message', () => {
    const err = normalizeContractError({ code: PaymentErrorCode.MerchantInactive });
    expect(err.code).toBe(PaymentErrorCode.MerchantInactive);
    expect(err.message).toBe(ERROR_MESSAGES[PaymentErrorCode.MerchantInactive]);
    expect(err.details).toBeUndefined();
  });

  it('wraps an unknown numeric code as InvalidInput, keeping context in details', () => {
    const err = normalizeContractError({ code: 9999, message: 'weird failure' });
    expect(err.code).toBe(PaymentErrorCode.InvalidInput);
    expect(err.details).toBe('weird failure');
  });

  it('wraps an unknown numeric code with no message as InvalidInput', () => {
    const err = normalizeContractError({ code: 9999 });
    expect(err.code).toBe(PaymentErrorCode.InvalidInput);
  });

  it('wraps a bare message object as InvalidInput', () => {
    const err = normalizeContractError({ message: 'network failure' });
    expect(err.code).toBe(PaymentErrorCode.InvalidInput);
    expect(err.details).toBe('network failure');
  });

  it('wraps a thrown Error as InvalidInput, preserving its message in details', () => {
    const err = normalizeContractError(new TypeError('fetch failed'));
    expect(err.code).toBe(PaymentErrorCode.InvalidInput);
    expect(err.details).toBe('fetch failed');
  });

  it('wraps primitive and nullish values as InvalidInput with a stringified detail', () => {
    expect(normalizeContractError('boom').details).toBe('boom');
    expect(normalizeContractError(42).details).toBe('42');
    expect(normalizeContractError(true).details).toBe('true');
    expect(normalizeContractError(null).details).toBe('null');
    expect(normalizeContractError(undefined).details).toBe('undefined');
    for (const value of ['boom', 42, true, null, undefined]) {
      expect(normalizeContractError(value)).toBeInstanceOf(LumenFlowError);
      expect(normalizeContractError(value).code).toBe(PaymentErrorCode.InvalidInput);
    }
  });

  it('ignores a non-numeric code field and falls back to the message', () => {
    const err = normalizeContractError({ code: 'NOPE', message: 'string code' });
    expect(err.code).toBe(PaymentErrorCode.InvalidInput);
    expect(err.details).toBe('string code');
  });

  it('produces a serializable error for any input', () => {
    for (const value of [{ code: 21 }, { message: 'x' }, 'y', null, new Error('z')]) {
      const err = normalizeContractError(value);
      expect(() => JSON.stringify(err)).not.toThrow();
      expect(JSON.parse(JSON.stringify(err)).name).toBe('LumenFlowError');
    }
  });
});
