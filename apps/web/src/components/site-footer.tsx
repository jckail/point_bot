import { LogoMark } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-faint sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <LogoMark size={20} />
          <span>PointUp - all your points, one clear view.</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/jckail/pointup"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-ink-muted"
          >
            GitHub
          </a>
          <span>Open architecture: TypeScript, Drizzle, PostgreSQL, AWS</span>
        </div>
      </div>
    </footer>
  );
}
