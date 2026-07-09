"use client";

import { useState, useTransition } from "react";

type ChatTurn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What's my best transfer right now?",
  "Am I at risk of points expiring?",
  "How do I finish my trip goal faster?",
  "Where's the best bang for my buck?",
];

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      role: "assistant",
      content:
        "Hi — I'm PointUp Assistant. Ask about transfers, expirations, trip goals, or bang-for-buck redemptions. I only use your linked balances (never passwords).",
    },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || pending) return;

    const history = turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .slice(-8);
    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/v1/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, history }),
        });
        const payload = (await response.json()) as {
          reply?: string;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Assistant request failed");
        }
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: payload.reply ?? "" },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/40 transition hover:bg-brand-strong"
      >
        {open ? "Close assistant" : "Ask PointUp"}
      </button>

      {open && (
        <section className="fixed bottom-20 right-5 z-50 flex h-[min(32rem,70vh)] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-midnight shadow-2xl">
          <header className="border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold text-ink">
              PointUp Assistant
            </h2>
            <p className="text-xs text-ink-faint">
              Grounded in your portfolio · optional LLM via LLM_API_KEY
            </p>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  turn.role === "user"
                    ? "ml-6 bg-brand/20 text-ink"
                    : "mr-4 bg-line/40 text-ink-muted"
                }`}
              >
                {turn.content}
              </div>
            ))}
            {pending && (
              <p className="text-xs text-ink-faint">Thinking…</p>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-line px-3 pt-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={pending}
                onClick={() => send(suggestion)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-faint transition hover:border-brand hover:text-ink"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about transfers, deals…"
              className="flex-1 rounded-xl border border-line bg-midnight px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={pending || input.trim().length === 0}
              className="rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
