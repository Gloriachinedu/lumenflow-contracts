/**
 * LumenFlow Shared Utilities
 * Common validation and helper functions for LumenFlow frontend applications
 */

/**
 * Validates a Stellar public key (G-address)
 * 
 * Stellar public keys are 56 characters long, start with 'G',
 * and use base32 encoding with a checksum.
 * 
 * @param {string} value - The address to validate
 * @returns {boolean} True if valid Stellar public key, false otherwise
 */
export function isValidStellarAddress(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  const trimmed = value.trim();
  
  // Basic format check: must start with 'G' and be 56 characters
  if (trimmed.length !== 56 || trimmed[0] !== 'G') {
    return false;
  }
  
  // Base32 character set (A-Z and 2-7)
  const base32Regex = /^[A-Z2-7]+$/;
  if (!base32Regex.test(trimmed)) {
    return false;
  }
  
  // Note: For full checksum validation, you would use @stellar/stellar-sdk's StrKey.decodeEd25519PublicKey
  // This regex-based validation is a lightweight first-pass check
  // For production use with the SDK, consider using:
  // import { StrKey } from '@stellar/stellar-sdk';
  // try { StrKey.decodeEd25519PublicKey(trimmed); return true; } catch { return false; }
  
  return true;
}

/**
 * Validates a Stellar contract ID (C-address)
 * 
 * Stellar contract IDs are 56 characters long, start with 'C',
 * and use base32 encoding with a checksum.
 * 
 * @param {string} value - The contract ID to validate
 * @returns {boolean} True if valid Stellar contract ID, false otherwise
 */
export function isValidStellarContractId(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  const trimmed = value.trim();
  
  // Basic format check: must start with 'C' and be 56 characters
  if (trimmed.length !== 56 || trimmed[0] !== 'C') {
    return false;
  }
  
  // Base32 character set (A-Z and 2-7)
  const base32Regex = /^[A-Z2-7]+$/;
  if (!base32Regex.test(trimmed)) {
    return false;
  }
  
  return true;
}
