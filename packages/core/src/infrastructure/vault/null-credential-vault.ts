import type {
  CredentialVault,
  ProviderCredential,
} from "../../application/ports";

/**
 * Used when no server-side vault is configured. Accounts can still be synced
 * with transient credentials supplied by the calling surface (Apple Keychain
 * on mobile, Chrome password manager in an extension).
 */
export class NullCredentialVault implements CredentialVault {
  async resolve(_credentialRef: string, _userId: string): Promise<ProviderCredential | null> {
    void _credentialRef;
    void _userId;
    return null;
  }
}
