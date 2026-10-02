"use client";
import { useEffect, useState } from "react";

type LinkStatus = { configured: boolean; linked: boolean; mode: "account-linking" };

export function ChatGptIdentitySettings({ callbackStatus }: { callbackStatus?: "linked" | "error" }) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/auth/chatgpt", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load identity status");
        const payload = await response.json() as LinkStatus;
        setStatus(payload);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  return <section className="card-surface p-6 sm:p-8" aria-labelledby="chatgpt-title">
    <h2 id="chatgpt-title" className="font-display text-xl font-semibold">ChatGPT identity</h2>
    <p className="mt-3 max-w-prose text-sm leading-7 text-ink-muted">Link your ChatGPT identity to this PointUp account. You will continue to OpenAI to approve the connection and then return here.</p>
    <p className="mt-2 max-w-prose text-sm leading-7 text-ink-muted">This connection links your identity. It does not provide access to ChatGPT subscription benefits or authorize an assistant to manage your loyalty accounts.</p>
    {callbackStatus === "linked" && status?.linked && <p role="status" className="mt-4 text-sm font-medium text-positive">Your ChatGPT identity was linked.</p>}
    {callbackStatus === "error" && <p role="alert" className="mt-4 text-sm text-danger">The connection could not be completed. Try again.</p>}
    {error ? <div className="mt-5"><p role="alert" className="text-sm text-danger">Connection status could not be loaded.</p><button type="button" onClick={()=>{setError(false);setAttempt(value=>value+1);}} className="mt-3 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand">Try again</button></div> : <>
      <p role="status" className="mt-5 text-sm text-ink-muted">{!status ? "Checking connection…" : status.linked ? "Connected to your PointUp account." : !status.configured ? "ChatGPT identity linking is not available on this installation yet." : "Ready to connect."}</p>
      <form action="/api/auth/chatgpt" method="post" className="mt-4" onSubmit={()=>setStarting(true)}>
        <button type="submit" disabled={!status?.configured || status?.linked || starting} className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{starting ? "Continuing to OpenAI…" : status?.linked ? "ChatGPT identity connected" : "Continue with ChatGPT"}</button>
      </form>
    </>}
  </section>;
}
