import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChatGptIdentitySettings } from "@/components/chatgpt-identity-settings";
import { getSessionUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Account settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ chatgpt?: string }> }) {
  if (!await getSessionUserId()) redirect("/");
  const { chatgpt } = await searchParams;
  return <main className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-10 sm:px-6">
    <Link href="/dashboard" className="text-sm font-semibold text-brand">Back to your portfolio</Link>
    <div>
      <h1 className="font-display text-3xl font-bold">Account settings</h1>
      <p className="mt-2 text-ink-muted">Manage identities connected to your PointUp account.</p>
      <Link href="/dashboard/agents" className="mt-3 inline-block text-sm font-semibold text-brand">Agent access and proposed changes</Link>
    </div>
    <ChatGptIdentitySettings callbackStatus={chatgpt === "linked" || chatgpt === "error" ? chatgpt : undefined} />
  </main>;
}
