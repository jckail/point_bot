import type {
  AccessTokenDto,
  AgentObservationDto,
  AgentSkillDto,
  ConsentDto,
  CreateAccessTokenRequest,
  CreatedAccessTokenDto,
  ObservationResultDto,
  SubmitObservationRequest,
  ActivityEventDto,
  AwardWatchDto,
  BulkUpdateMembershipRequest,
  BulkUpdateMembershipResultDto,
  CreateAwardWatchRequest,
  CustomValuationDto,
  UpdateUserSettingsRequest,
  UserSettingsDto,
  SetCustomValuationRequest,
  ApiError,
  ChatAssistantRequest,
  ChatAssistantResponse,
  CreatePortfolioShareRequest,
  CreateTripGoalRequest,
  DeletedAccountDto,
  ImportPortfolioRequest,
  ImportPortfolioResultDto,
  IngestDealPageResultDto,
  LinkLoyaltyAccountRequest,
  LoyaltyAccountDto,
  BalanceDto,
  PortfolioExportDto,
  PortfolioShareDto,
  PortfolioSummaryDto,
  ProviderDto,
  PublicPortfolioSnapshotDto,
  RecordManualBalanceRequest,
  ScrapeDealRequest,
  SyncLoyaltyAccountRequest,
  SyncOutcomeDto,
  TripGoalDto,
  UpdateLoyaltyAccountRequest,
  UpdateTripGoalRequest,
  PlanRedemptionQuery,
  PlanRedemptionResultDto,
  RecordTransferBonusRequest,
  SweetSpotDto,
  TransferBonusDto,
  ValueAdviceDto,
} from "@pointup/core/contracts";

/**
 * Typed client for the PointUp HTTP API. It only uses `fetch` and the wire
 * contracts, so it runs on any surface: web, React Native / Expo, and
 * browser extensions (call it from the extension's background service
 * worker).
 *
 * Authentication is pluggable: the web app rides on the Clerk session cookie
 * (pass `credentials: "include"`), while mobile and extensions attach a Clerk
 * session token as a bearer header (see docs/multi-surface.md).
 */

export interface PointUpClientOptions {
  /** e.g. https://app.pointup.example or http://localhost:3000 */
  readonly baseUrl: string;
  /** Custom fetch (tests, React Native polyfills). Defaults to global fetch. */
  readonly fetch?: typeof fetch;
  /** Extra headers, e.g. { Authorization: `Bearer ${token}` }. */
  readonly headers?: Record<string, string>;
  /** Cookie behavior; the web surface should use "include". */
  readonly credentials?: RequestCredentials;
  /**
   * Per-request timeout in milliseconds; requests abort with a TimeoutError
   * when exceeded. Defaults to 30s - generous enough for a full batch sync,
   * short enough that mobile surfaces never hang on dead radios.
   */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class PointUpApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Server correlation id (`x-request-id`), when the API returned one. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "PointUpApiError";
  }
}

export class PointUpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PointUpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  listProviders(): Promise<ProviderDto[]> {
    return this.request("GET", "/api/v1/providers");
  }

  /** The OpenAPI 3.1 document describing this API (public). */
  getOpenApiDocument(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/v1/openapi.json");
  }

  listLoyaltyAccounts(): Promise<LoyaltyAccountDto[]> {
    return this.request("GET", "/api/v1/loyalty-accounts");
  }

  getLoyaltyAccount(accountId: string): Promise<LoyaltyAccountDto> {
    return this.request("GET", this.accountPath(accountId));
  }

  linkLoyaltyAccount(
    body: LinkLoyaltyAccountRequest,
  ): Promise<{ accountId: string }> {
    return this.request("POST", "/api/v1/loyalty-accounts", body);
  }

  updateLoyaltyAccount(
    accountId: string,
    body: UpdateLoyaltyAccountRequest,
  ): Promise<LoyaltyAccountDto> {
    return this.request("PATCH", this.accountPath(accountId), body);
  }

  unlinkLoyaltyAccount(accountId: string): Promise<void> {
    return this.request("DELETE", this.accountPath(accountId));
  }

  /** Bulk-edit membership numbers; returns per-item success/failure counts. */
  bulkUpdateMembershipNumbers(
    body: BulkUpdateMembershipRequest,
  ): Promise<BulkUpdateMembershipResultDto> {
    return this.request("PATCH", "/api/v1/loyalty-accounts", body);
  }

  listCustomValuations(): Promise<CustomValuationDto[]> {
    return this.request("GET", "/api/v1/valuations");
  }

  listAwardWatches(): Promise<AwardWatchDto[]> {
    return this.request("GET", "/api/v1/watches");
  }

  createAwardWatch(body: CreateAwardWatchRequest): Promise<AwardWatchDto> {
    return this.request("POST", "/api/v1/watches", body);
  }

  deleteAwardWatch(watchId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/v1/watches/${encodeURIComponent(watchId)}`,
    );
  }

  getUserSettings(): Promise<UserSettingsDto> {
    return this.request("GET", "/api/v1/settings");
  }

  updateUserSettings(
    body: UpdateUserSettingsRequest,
  ): Promise<UserSettingsDto> {
    return this.request("PUT", "/api/v1/settings", body);
  }

  setCustomValuation(
    providerId: string,
    body: SetCustomValuationRequest,
  ): Promise<CustomValuationDto> {
    return this.request(
      "PUT",
      `/api/v1/valuations/${encodeURIComponent(providerId)}`,
      body,
    );
  }

  deleteCustomValuation(providerId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/v1/valuations/${encodeURIComponent(providerId)}`,
    );
  }

  /** Balance history, newest first (default 50, max 365 entries). */
  getBalanceHistory(accountId: string, limit?: number): Promise<BalanceDto[]> {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return this.request(
      "GET",
      `${this.accountPath(accountId)}/balances${query}`,
    );
  }

  recordManualBalance(
    accountId: string,
    body: RecordManualBalanceRequest,
  ): Promise<BalanceDto> {
    return this.request(
      "POST",
      `${this.accountPath(accountId)}/balances`,
      body,
    );
  }

  syncLoyaltyAccount(
    accountId: string,
    body: SyncLoyaltyAccountRequest = {},
  ): Promise<BalanceDto> {
    return this.request("POST", `${this.accountPath(accountId)}/sync`, body);
  }

  /** Sync every linked account; returns per-account outcomes. */
  syncAllLoyaltyAccounts(): Promise<SyncOutcomeDto[]> {
    return this.request("POST", "/api/v1/sync");
  }

  getPortfolioSummary(): Promise<PortfolioSummaryDto> {
    return this.request("GET", "/api/v1/summary");
  }

  listActivity(limit?: number): Promise<ActivityEventDto[]> {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return this.request("GET", `/api/v1/activity${query}`);
  }

  listExpiringAccounts(withinDays?: number): Promise<LoyaltyAccountDto[]> {
    const query =
      withinDays !== undefined ? `?withinDays=${withinDays}` : "";
    return this.request("GET", `/api/v1/expiring${query}`);
  }

  /** Portable dump of accounts + history. Defaults to JSON. */
  exportPortfolio(format: "json" | "csv" = "json"): Promise<PortfolioExportDto | string> {
    if (format === "csv") {
      return this.requestText("GET", "/api/v1/export?format=csv");
    }
    return this.request("GET", "/api/v1/export?format=json");
  }

  importPortfolio(
    body: ImportPortfolioRequest,
  ): Promise<ImportPortfolioResultDto> {
    return this.request("POST", "/api/v1/import", body);
  }

  listTripGoals(): Promise<TripGoalDto[]> {
    return this.request("GET", "/api/v1/goals");
  }

  createTripGoal(body: CreateTripGoalRequest): Promise<TripGoalDto> {
    return this.request("POST", "/api/v1/goals", body);
  }

  updateTripGoal(
    goalId: string,
    body: UpdateTripGoalRequest,
  ): Promise<TripGoalDto> {
    return this.request(
      "PATCH",
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      body,
    );
  }

  deleteTripGoal(goalId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
    );
  }

  /** iCalendar feed of account expiration dates. */
  getExpirationCalendar(): Promise<string> {
    return this.requestText("GET", "/api/v1/calendar.ics", "text/calendar");
  }

  seedDemoPortfolio(): Promise<{ accountIds: string[]; goalId: string | null }> {
    return this.request("POST", "/api/v1/demo");
  }

  listDeletedLoyaltyAccounts(): Promise<DeletedAccountDto[]> {
    return this.request("GET", "/api/v1/loyalty-accounts/deleted");
  }

  restoreLoyaltyAccount(accountId: string): Promise<LoyaltyAccountDto> {
    return this.request(
      "POST",
      `${this.accountPath(accountId)}/restore`,
    );
  }

  listPortfolioShares(): Promise<PortfolioShareDto[]> {
    return this.request("GET", "/api/v1/shares");
  }

  createPortfolioShare(
    body: CreatePortfolioShareRequest = {},
  ): Promise<PortfolioShareDto> {
    return this.request("POST", "/api/v1/shares", body);
  }

  revokePortfolioShare(shareId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/v1/shares/${encodeURIComponent(shareId)}`,
    );
  }

  getPublicPortfolioSnapshot(
    token: string,
  ): Promise<PublicPortfolioSnapshotDto> {
    return this.request(
      "GET",
      `/api/v1/public/share/${encodeURIComponent(token)}`,
    );
  }

  chatWithAssistant(
    body: ChatAssistantRequest,
  ): Promise<ChatAssistantResponse> {
    return this.request("POST", "/api/v1/assistant/chat", body);
  }

  getValueAdvice(): Promise<ValueAdviceDto> {
    return this.request("GET", "/api/v1/value-advice");
  }

  /** Ranked redemption plans (optimizer). Estimates; see each plan's caveats. */
  planRedemption(
    query: Partial<Omit<PlanRedemptionQuery, never>> = {},
  ): Promise<PlanRedemptionResultDto> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return this.request("GET", `/api/v1/optimizer/plan${qs ? `?${qs}` : ""}`);
  }

  listSweetSpots(filter: { kind?: string; programId?: string } = {}): Promise<SweetSpotDto[]> {
    const params = new URLSearchParams();
    if (filter.kind) params.set("kind", filter.kind);
    if (filter.programId) params.set("programId", filter.programId);
    const qs = params.toString();
    return this.request("GET", `/api/v1/deals/sweet-spots${qs ? `?${qs}` : ""}`);
  }

  listTransferBonuses(): Promise<TransferBonusDto[]> {
    return this.request("GET", "/api/v1/transfer-bonuses");
  }

  /** Report a transfer bonus (crowd data; stored unverified). Needs portfolio:write. */
  recordTransferBonus(body: RecordTransferBonusRequest): Promise<TransferBonusDto> {
    return this.request("POST", "/api/v1/transfer-bonuses", body);
  }

  scrapeDeal(body: ScrapeDealRequest): Promise<{
    ingest: IngestDealPageResultDto;
    advice: ValueAdviceDto;
  }> {
    return this.request("POST", "/api/v1/deals/scrape", body);
  }

  private accountPath(accountId: string): string {
    return `/api/v1/loyalty-accounts/${encodeURIComponent(accountId)}`;
  }

  // ─── Agent surface ───────────────────────────────────────────────────────

  listAgentSkills(providerId?: string): Promise<AgentSkillDto[]> {
    const query = providerId
      ? `?providerId=${encodeURIComponent(providerId)}`
      : "";
    return this.request("GET", `/api/v1/skills${query}`);
  }

  listConsents(): Promise<ConsentDto[]> {
    return this.request("GET", "/api/v1/consents");
  }

  // There is deliberately no grantConsent: granting consent is a session-only
  // human action (dashboard). Tokens can list and revoke only.

  revokeConsent(consentId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/v1/consents/${encodeURIComponent(consentId)}`,
    );
  }

  /** Write back a balance an agent read; needs a consent for the program. */
  submitObservation(
    body: SubmitObservationRequest,
  ): Promise<ObservationResultDto> {
    return this.request("POST", "/api/v1/agent/observations", body);
  }

  listObservations(): Promise<AgentObservationDto[]> {
    return this.request("GET", "/api/v1/agent/observations");
  }

  /** Session-auth only: a token cannot mint tokens. */
  listAccessTokens(): Promise<AccessTokenDto[]> {
    return this.request("GET", "/api/v1/tokens");
  }

  createAccessToken(
    body: CreateAccessTokenRequest,
  ): Promise<CreatedAccessTokenDto> {
    return this.request("POST", "/api/v1/tokens", body);
  }

  revokeAccessToken(tokenId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/api/v1/tokens/${encodeURIComponent(tokenId)}`,
    );
  }

  private async requestText(
    method: string,
    path: string,
    accept = "text/csv",
  ): Promise<string> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        Accept: accept,
        ...this.options.headers,
      },
      credentials: this.options.credentials,
      signal: AbortSignal.timeout(
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ),
    });

    if (!response.ok) {
      const fallback: ApiError = {
        error: { code: "UNKNOWN", message: response.statusText },
      };
      const payload = (await response
        .json()
        .catch(() => fallback)) as ApiError;
      throw new PointUpApiError(
        response.status,
        payload.error?.code ?? "UNKNOWN",
        payload.error?.message ?? response.statusText,
        payload.error?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      );
    }
    return response.text();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...this.options.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: this.options.credentials,
      signal: AbortSignal.timeout(
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ),
    });

    if (!response.ok) {
      const fallback: ApiError = {
        error: { code: "UNKNOWN", message: response.statusText },
      };
      const payload = (await response
        .json()
        .catch(() => fallback)) as ApiError;
      throw new PointUpApiError(
        response.status,
        payload.error?.code ?? "UNKNOWN",
        payload.error?.message ?? response.statusText,
        payload.error?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

export function createPointUpClient(
  options: PointUpClientOptions,
): PointUpClient {
  return new PointUpClient(options);
}

export type {
  AccessTokenDto,
  AgentObservationDto,
  AgentSkillDto,
  ConsentDto,
  CreateAccessTokenRequest,
  CreatedAccessTokenDto,
  ObservationResultDto,
  SubmitObservationRequest,
  ActivityEventDto,
  ApiError,
  BalanceDto,
  ChatAssistantRequest,
  ChatAssistantResponse,
  CreatePortfolioShareRequest,
  CreateTripGoalRequest,
  DeletedAccountDto,
  ImportPortfolioRequest,
  ImportPortfolioResultDto,
  IngestDealPageResultDto,
  LinkLoyaltyAccountRequest,
  LoyaltyAccountDto,
  PortfolioExportDto,
  PortfolioShareDto,
  PortfolioSummaryDto,
  ProviderDto,
  PublicPortfolioSnapshotDto,
  RecordManualBalanceRequest,
  ScrapeDealRequest,
  SyncLoyaltyAccountRequest,
  SyncOutcomeDto,
  TripGoalDto,
  UpdateLoyaltyAccountRequest,
  UpdateTripGoalRequest,
  PlanRedemptionQuery,
  PlanRedemptionResultDto,
  RecordTransferBonusRequest,
  SweetSpotDto,
  TransferBonusDto,
  ValueAdviceDto,
} from "@pointup/core/contracts";
