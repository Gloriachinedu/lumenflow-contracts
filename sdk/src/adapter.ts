import nacl from "tweetnacl";

/**
 * Validates a Stellar public key (G-address)
 * 
 * Stellar public keys are 56 characters long, start with 'G',
 * and use base32 encoding with a checksum.
 * 
 * @param value - The address to validate
 * @returns True if valid Stellar public key, false otherwise
 */
export function isValidStellarAddress(value: string): boolean {
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
  
  return true;
}

/**
 * Validates a Stellar contract ID (C-address)
 * 
 * Stellar contract IDs are 56 characters long, start with 'C',
 * and use base32 encoding with a checksum.
 * 
 * @param value - The contract ID to validate
 * @returns True if valid Stellar contract ID, false otherwise
 */
export function isValidStellarContractId(value: string): boolean {
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

/**
 * WalletAdapter interface for decoupling signing logic from the SDK core.
 * Implementations can support browser wallets (Freighter, Albedo), CLI tools,
 * or server-side key management.
 */
export interface WalletAdapter {
  /**
   * Get the public key of the wallet as a hex string.
   */
  getPublicKey(): Promise<string>;

  /**
   * Sign a transaction or payload.
   * @param payload - The data to sign as a Buffer or Uint8Array
   * @returns The signature as a Buffer or Uint8Array
   */
  signTransaction(payload: Buffer | Uint8Array): Promise<Buffer | Uint8Array>;

  /**
   * Check if the wallet is connected/available.
   */
  isConnected(): boolean;
}

/**
 * FreighterAdapter implements WalletAdapter using the Freighter browser extension.
 * This adapter is designed for browser-based applications.
 */
export class FreighterAdapter implements WalletAdapter {
  private publicKey: string = '';

  constructor() {
    if (typeof window !== 'undefined' && (window as any).freighter) {
      this.isConnected = () => true;
    } else {
      this.isConnected = () => false;
    }
  }

  async getPublicKey(): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('Freighter wallet is not available');
    }
    if (this.publicKey) {
      return this.publicKey;
    }
    const freighter = (window as any).freighter;
    const account = await freighter.getConnectedAccount();
    this.publicKey = account.publicKey;
    return this.publicKey;
  }

  async signTransaction(payload: Buffer | Uint8Array): Promise<Buffer> {
    if (!this.isConnected()) {
      throw new Error('Freighter wallet is not available');
    }
    const freighter = (window as any).freighter;
    const signature = await freighter.signTransaction(Buffer.from(payload).toString('hex'));
    return Buffer.from(signature, 'hex');
  }

  isConnected(): boolean {
    return typeof window !== 'undefined' && (window as any).freighter !== undefined;
  }
}

/**
 * KeypairAdapter implements WalletAdapter using a raw ed25519 keypair.
 * This adapter is designed for CLI, server-side, or testing environments.
 */
export interface Keypair {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 64 bytes (seed + public key, as returned by nacl.sign.keyPair)
}

export class KeypairAdapter implements WalletAdapter {
  private keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
  }

  async getPublicKey(): Promise<string> {
    return Buffer.from(this.keypair.publicKey).toString('hex');
  }

  async signTransaction(payload: Buffer | Uint8Array): Promise<Buffer> {
    const signature = nacl.sign.detached(payload, this.keypair.secretKey);
    return Buffer.from(signature);
  }

  isConnected(): boolean {
    return true; // Keypair is always "connected"
  }

  /**
   * Generate a new random keypair.
   */
  static generate(): KeypairAdapter {
    const keypair = nacl.sign.keyPair();
    return new KeypairAdapter({
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
    });
  }

  /**
   * Create an adapter from a secret key (32 bytes seed).
   */
  static fromSecretKey(secretKey: Uint8Array): KeypairAdapter {
    const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
    return new KeypairAdapter({
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
    });
  }
}
