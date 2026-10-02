-- Add explicit user selection without inferring eligibility from historical data.
-- Apply before deploying account writers and retire old unconditional advice.
SET LOCAL lock_timeout = '30s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "card_product_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD CONSTRAINT "loyalty_account_card_product_check" CHECK (
  "card_product_id" IS NULL OR (
    "provider_id" = 'chase-ultimate-rewards' AND "card_product_id" IN (
      'chase-sapphire-preferred', 'chase-sapphire-reserve',
      'chase-ink-business-preferred', 'chase-ink-plus', 'chase-corporate-flex'
    )
  )
);
