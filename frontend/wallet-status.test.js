/**
 * wallet-status.test.js
 * Unit tests for wallet-status.js error mapping utilities.
 *
 * Run with: node --test frontend/wallet-status.test.js
 * (Node.js built-in test runner, available since Node 18)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Browser API shims for Node.js ─────────────────────────────────────────────
global.window = {
  LUMENFLOW_NETWORK: 'testnet',
};

// Dynamic import after setting up global.window
const {
  WalletErrorCode,
  DEFAULT_MESSAGES,
  classifyWalletError,
  resolveWalletError,
  setMessages,
  getMessages,
  FREIGHTER_INSTALL_URL,
  FREIGHTER_TROUBLESHOOT_URL,
  EXPECTED_NETWORK,
} = await import('./wallet-status.js');

// ── classifyWalletError ───────────────────────────────────────────────────────

describe('classifyWalletError', () => {
  it('returns NOT_FOUND for "Freighter not available" error', () => {
    const result = classifyWalletError(new Error('Freighter not available'));
    assert.equal(result.code, WalletErrorCode.NOT_FOUND);
  });

  it('returns NOT_FOUND for "extension not found" string error', () => {
    const result = classifyWalletError('extension not found');
    assert.equal(result.code, WalletErrorCode.NOT_FOUND);
  });

  it('returns NOT_FOUND for "no wallet" message', () => {
    const result = classifyWalletError(new Error('No wallet detected'));
    assert.equal(result.code, WalletErrorCode.NOT_FOUND);
  });

  it('returns REJECTED for "User rejected" error', () => {
    const result = classifyWalletError(new Error('User rejected the request'));
    assert.equal(result.code, WalletErrorCode.REJECTED);
  });

  it('returns REJECTED for "denied" message', () => {
    const result = classifyWalletError(new Error('Connection denied by user'));
    assert.equal(result.code, WalletErrorCode.REJECTED);
  });

  it('returns REJECTED for "cancelled" message', () => {
    const result = classifyWalletError(new Error('Operation cancelled'));
    assert.equal(result.code, WalletErrorCode.REJECTED);
  });

  it('returns WRONG_NETWORK for "wrong network" error', () => {
    const result = classifyWalletError(
      new Error('Wrong network selected'),
      { currentNetwork: 'mainnet' }
    );
    assert.equal(result.code, WalletErrorCode.WRONG_NETWORK);
    assert.equal(result.currentNetwork, 'mainnet');
  });

  it('returns UNAUTHORIZED for "unauthorized" error', () => {
    const result = classifyWalletError(new Error('Unauthorized access'));
    assert.equal(result.code, WalletErrorCode.UNAUTHORIZED);
  });

  it('returns UNAUTHORIZED for "permission denied" message', () => {
    const result = classifyWalletError(new Error('Permission denied'));
    assert.equal(result.code, WalletErrorCode.UNAUTHORIZED);
  });

  it('returns TIMEOUT for "timed out" error', () => {
    const result = classifyWalletError(new Error('Request timed out'));
    assert.equal(result.code, WalletErrorCode.TIMEOUT);
  });

  it('returns UNKNOWN for unrecognised error', () => {
    const result = classifyWalletError(new Error('Something unexpected happened'));
    assert.equal(result.code, WalletErrorCode.UNKNOWN);
  });

  it('handles non-Error string input', () => {
    const result = classifyWalletError('freighter is not installed');
    assert.equal(result.code, WalletErrorCode.NOT_FOUND);
  });

  it('handles null/undefined gracefully', () => {
    const result = classifyWalletError(null);
    assert.equal(result.code, WalletErrorCode.UNKNOWN);
  });
});

// ── resolveWalletError ────────────────────────────────────────────────────────

describe('resolveWalletError', () => {
  it('returns title and detail for NOT_FOUND', () => {
    const msg = resolveWalletError(new Error('Freighter not available'));
    assert.equal(msg.code, WalletErrorCode.NOT_FOUND);
    assert.ok(msg.title.length > 0, 'title should not be empty');
    assert.ok(msg.detail.length > 0, 'detail should not be empty');
  });

  it('NOT_FOUND detail includes freighter.app install link', () => {
    const msg = resolveWalletError(new Error('not found'));
    assert.ok(msg.detail.includes(FREIGHTER_INSTALL_URL),
      `detail should include ${FREIGHTER_INSTALL_URL}`);
  });

  it('REJECTED detail prompts user to approve in Freighter', () => {
    const msg = resolveWalletError(new Error('User rejected'));
    assert.equal(msg.code, WalletErrorCode.REJECTED);
    assert.ok(
      msg.detail.toLowerCase().includes('approve') ||
      msg.detail.toLowerCase().includes('freighter'),
      'REJECTED detail should mention approval or Freighter'
    );
  });

  it('WRONG_NETWORK detail includes current and expected network names', () => {
    const msg = resolveWalletError(
      new Error('Wrong network'),
      { currentNetwork: 'mainnet' }
    );
    assert.equal(msg.code, WalletErrorCode.WRONG_NETWORK);
    assert.ok(msg.detail.includes('mainnet'), 'detail should show current network');
    assert.ok(msg.detail.includes(EXPECTED_NETWORK), 'detail should show expected network');
  });

  it('WRONG_NETWORK handles missing currentNetwork gracefully', () => {
    const msg = resolveWalletError(new Error('Wrong network'));
    assert.equal(msg.code, WalletErrorCode.WRONG_NETWORK);
    assert.ok(msg.detail.length > 0);
  });

  it('UNKNOWN detail includes troubleshooting link', () => {
    const msg = resolveWalletError(new Error('mystery failure'));
    assert.equal(msg.code, WalletErrorCode.UNKNOWN);
    assert.ok(
      msg.detail.includes(FREIGHTER_TROUBLESHOOT_URL) ||
      msg.detail.toLowerCase().includes('troubleshoot'),
      'UNKNOWN detail should include a troubleshooting link'
    );
  });
});

// ── setMessages / getMessages (i18n) ──────────────────────────────────────────

describe('setMessages (i18n)', () => {
  it('allows overriding NOT_FOUND message', () => {
    setMessages({
      [WalletErrorCode.NOT_FOUND]: {
        title: 'Extension introuvable',
        detail: 'Veuillez installer Freighter.',
      },
    });

    const msg = resolveWalletError(new Error('Freighter not available'));
    assert.equal(msg.title, 'Extension introuvable');
    assert.ok(msg.detail.includes('Freighter'));

    // Restore default
    setMessages({
      [WalletErrorCode.NOT_FOUND]: DEFAULT_MESSAGES[WalletErrorCode.NOT_FOUND],
    });
  });

  it('leaves other messages unchanged when partially overriding', () => {
    setMessages({
      [WalletErrorCode.REJECTED]: {
        title: 'Demande refusée',
        detail: 'Approuvez dans Freighter.',
      },
    });

    // NOT_FOUND should still be default
    const notFound = resolveWalletError(new Error('not found'));
    assert.ok(notFound.detail.includes(FREIGHTER_INSTALL_URL));

    // REJECTED should be overridden
    const rejected = resolveWalletError(new Error('User rejected'));
    assert.equal(rejected.title, 'Demande refusée');

    // Restore
    setMessages({
      [WalletErrorCode.REJECTED]: DEFAULT_MESSAGES[WalletErrorCode.REJECTED],
    });
  });

  it('getMessages returns updated catalogue after setMessages', () => {
    const before = getMessages()[WalletErrorCode.TIMEOUT];
    setMessages({
      [WalletErrorCode.TIMEOUT]: { title: 'Délai expiré', detail: 'Réessayez.' },
    });
    const after = getMessages()[WalletErrorCode.TIMEOUT];
    assert.equal(after.title, 'Délai expiré');

    // Restore
    setMessages({ [WalletErrorCode.TIMEOUT]: before });
  });
});

// ── DEFAULT_MESSAGES completeness ─────────────────────────────────────────────

describe('DEFAULT_MESSAGES', () => {
  it('has an entry for every WalletErrorCode', () => {
    for (const code of Object.values(WalletErrorCode)) {
      assert.ok(
        DEFAULT_MESSAGES[code],
        `DEFAULT_MESSAGES should have an entry for ${code}`
      );
    }
  });

  it('every entry has non-empty title and detail', () => {
    for (const [code, entry] of Object.entries(DEFAULT_MESSAGES)) {
      assert.ok(
        typeof entry.title === 'string' && entry.title.length > 0,
        `${code}.title should be a non-empty string`
      );
      assert.ok(
        typeof entry.detail === 'string' || typeof entry.detail === 'function',
        `${code}.detail should be a string or function`
      );
    }
  });
});
