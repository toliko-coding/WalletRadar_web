const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Base58 shape check only — doesn't verify the address is on-curve or exists. Safe for client components (no server-only I/O). */
export function isValidSolanaAddress(address: string): boolean {
  return SOLANA_ADDRESS_RE.test(address);
}
