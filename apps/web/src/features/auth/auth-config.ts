import type { AuthProviderType } from './types';

/**
 * Resolves the configured authentication provider.
 * First-party GrowSpace authentication is the sole authoritative authentication provider.
 */
export function getAuthProvider(): AuthProviderType {
  return 'first_party';
}

/**
 * Returns true if the first-party authentication provider is enabled.
 */
export function isFirstPartyAuthEnabled(): boolean {
  return true;
}
