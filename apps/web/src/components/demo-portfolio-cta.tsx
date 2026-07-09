import { seedDemoPortfolioAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function DemoPortfolioCta() {
  return (
    <section className="card-surface flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Try a sample portfolio
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Load five demo programs, balance history, and a Kyoto trip goal — no
          credentials needed. You can unlink anytime.
        </p>
      </div>
      <form action={seedDemoPortfolioAction}>
        <Button type="submit" size="sm">
          Load sample data
        </Button>
      </form>
    </section>
  );
}
