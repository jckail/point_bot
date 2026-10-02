import { LogoMark } from "@/components/logo";
export function SiteFooter() {
  return <footer className="border-t border-line bg-surface"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-5 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:px-6"><div className="flex items-center gap-2"><LogoMark size={24}/><span>PointUp. Your next trip starts here.</span></div><a href="https://github.com/jckail/pointup" target="_blank" rel="noreferrer" className="font-medium hover:text-brand">View source on GitHub</a></div></footer>;
}
