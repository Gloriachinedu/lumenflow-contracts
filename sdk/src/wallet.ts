// Minimal wallet adapter helpers for Freighter and Albedo
// This file is intended as a lightweight adapter used by the dashboard UI.

export type WalletInfo = {
  type: 'freighter' | 'albedo' | 'none',
  account?: string,
}

const STORAGE_KEY = 'lumenflow_wallet';

export function saveWallet(w: WalletInfo) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(w)); } catch(e){}
}
export function loadWallet(): WalletInfo | null {
  try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch(e){ return null; }
}

export async function connectFreighter() {
  if (!(window as any).freighter) throw new Error('Freighter not available');
  const freighter = (window as any).freighter;
  const account = await freighter.getConnectedAccount();
  const info: WalletInfo = {type: 'freighter', account: account.publicKey};
  saveWallet(info);
  return info;
}

export async function connectAlbedo() {
  if (!(window as any).albedo) throw new Error('Albedo not available');
  const albedo = (window as any).albedo;
  const resp = await albedo.publicKey();
  const info: WalletInfo = {type: 'albedo', account: resp.publicKey || resp};
  saveWallet(info);
  return info;
}

export function disconnectWallet() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e){}
}
