import type { DomainEvent } from "../../domain/events";

/**
 * Records domain events. The Drizzle adapter writes to the transactional
 * outbox using the ambient transaction when called inside
 * `UnitOfWork.run`, so state and events commit (or roll back) together.
 */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

/**
 * Runs `work` atomically: every repository call and `publish` made inside it
 * (including nested use cases) joins one database transaction. Re-entrant:
 * a nested `run` joins the outer one.
 */
export interface UnitOfWork {
  /** True when `run` really is transactional (rolls back on error). */
  readonly atomic: boolean;
  run<T>(work: () => Promise<T>): Promise<T>;
}

/** What a use case needs to emit events atomically with its state change. */
export interface Eventing {
  readonly publisher: EventPublisher;
  readonly unitOfWork: UnitOfWork;
}

/** Default: no outbox configured. Runs work directly and drops events. */
export const noopEventing: Eventing = {
  publisher: { publish: async () => {} },
  unitOfWork: { atomic: false, run: (work) => work() },
};
