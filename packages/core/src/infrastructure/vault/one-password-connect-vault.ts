import type {
  CredentialVault,
  ProviderCredential,
} from "../../application/ports";

export interface OnePasswordConnectOptions {
  /** Base URL of the 1Password Connect server, e.g. https://op-connect.internal:8080 */
  readonly baseUrl: string;
  readonly token: string;
}

interface OnePasswordField {
  readonly purpose?: string;
  readonly value?: string;
}

interface OnePasswordItem {
  readonly fields?: OnePasswordField[];
}

/**
 * Resolves credentials from a self-hosted 1Password Connect server
 * (https://developer.1password.com/docs/connect/).
 *
 * The `credentialRef` format is "op://<vaultId>/<itemId>".
 */
export class OnePasswordConnectVault implements CredentialVault {
  constructor(private readonly options: OnePasswordConnectOptions) {}

  async resolve(credentialRef: string): Promise<ProviderCredential | null> {
    const parsed = this.parseRef(credentialRef);
    if (!parsed) return null;

    const response = await fetch(
      `${this.options.baseUrl}/v1/vaults/${parsed.vaultId}/items/${parsed.itemId}`,
      {
        headers: { Authorization: `Bearer ${this.options.token}` },
      },
    );
    if (!response.ok) return null;

    const item = (await response.json()) as OnePasswordItem;
    const username = item.fields?.find(
      (field) => field.purpose === "USERNAME",
    )?.value;
    const secret = item.fields?.find(
      (field) => field.purpose === "PASSWORD",
    )?.value;

    if (!username || !secret) return null;
    return { username, secret };
  }

  private parseRef(
    credentialRef: string,
  ): { vaultId: string; itemId: string } | null {
    const match = /^op:\/\/([^/]+)\/([^/]+)$/.exec(credentialRef);
    if (!match) return null;
    return { vaultId: match[1]!, itemId: match[2]! };
  }
}
