import { WalletAdapter, FreighterAdapter, KeypairAdapter, Keypair } from './adapter';

describe('WalletAdapter', () => {
  describe('KeypairAdapter', () => {
    it('should generate a new keypair', () => {
      const adapter = KeypairAdapter.generate();
      expect(adapter).toBeInstanceOf(KeypairAdapter);
      expect(adapter.isConnected()).toBe(true);
    });

    it('should create adapter from secret key', () => {
      const keypair = KeypairAdapter.generate();
      const secretKey = (keypair as any).keypair.secretKey;
      const adapter = KeypairAdapter.fromSecretKey(secretKey);
      expect(adapter).toBeInstanceOf(KeypairAdapter);
      expect(adapter.isConnected()).toBe(true);
    });

    it('should return public key as hex string', async () => {
      const adapter = KeypairAdapter.generate();
      const publicKey = await adapter.getPublicKey();
      expect(typeof publicKey).toBe('string');
      expect(publicKey.length).toBe(64); // 32 bytes * 2 hex chars
    });

    it('should sign a payload', async () => {
      const adapter = KeypairAdapter.generate();
      const payload = Buffer.from('test payload');
      const signature = await adapter.signTransaction(payload);
      expect(signature).toBeInstanceOf(Buffer);
      expect(signature.length).toBe(64); // ed25519 signature is 64 bytes
    });

    it('should always be connected', () => {
      const adapter = KeypairAdapter.generate();
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('FreighterAdapter', () => {
    it('should be disconnected when window is undefined', () => {
      const originalWindow = global.window;
      delete (global as any).window;
      
      const adapter = new FreighterAdapter();
      expect(adapter.isConnected()).toBe(false);
      
      global.window = originalWindow;
    });

    it('should be connected when freighter is available', () => {
      const originalWindow = global.window;
      (global as any).window = {
        freighter: {
          getConnectedAccount: jest.fn(),
          signTransaction: jest.fn(),
        },
      };
      
      const adapter = new FreighterAdapter();
      expect(adapter.isConnected()).toBe(true);
      
      global.window = originalWindow;
    });

    it('should throw error when getting public key while disconnected', async () => {
      const originalWindow = global.window;
      delete (global as any).window;
      
      const adapter = new FreighterAdapter();
      await expect(adapter.getPublicKey()).rejects.toThrow('Freighter wallet is not available');
      
      global.window = originalWindow;
    });

    it('should throw error when signing while disconnected', async () => {
      const originalWindow = global.window;
      delete (global as any).window;
      
      const adapter = new FreighterAdapter();
      const payload = Buffer.from('test');
      await expect(adapter.signTransaction(payload)).rejects.toThrow('Freighter wallet is not available');
      
      global.window = originalWindow;
    });
  });
});
