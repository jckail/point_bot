"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { assistantChatFailure, requestAssistantChat } from "./assistant-chat-outcome";
import { serializeAssistantChatRequest } from "./assistant-chat-request";

import { ReviewedAssistantActions } from "@/components/reviewed-assistant-actions";

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  shortened?: boolean;
};
type ChatError = { message: string; requestId?: string };

const MESSAGE_LIMIT = 4_000;
const TRANSCRIPT_LIMIT = 40;
const REQUEST_TIMEOUT_MS = 125_000;
const GREETING: ChatTurn = {
  role: "assistant",
  content:
    "Ask about your linked balances, expiring points, trip goals, and redemption estimates. I can help you compare options. Proposed account changes need your approval in PointUp; I cannot book travel or transfer points.",
};

const SUGGESTIONS = [
  "What's my best transfer right now?",
  "Am I at risk of points expiring?",
  "How do I finish my trip goal faster?",
  "Where's the best bang for my buck?",
];

export function AssistantPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([GREETING]);
  const [error, setError] = useState<ChatError | null>(null);
  const [actionsVersion, setActionsVersion] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [turns, pending]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function closeAssistant() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function clearChat() {
    if (requestRef.current) return;
    setTurns([GREETING]);
    setInput("");
    setError(null);
    inputRef.current?.focus();
  }

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || pending || requestRef.current) return;
    if (trimmed.length > MESSAGE_LIMIT) {
      setError({ message: "Keep your message to 4,000 characters or fewer." });
      return;
    }

    const lastTurn = turns.at(-1);
    const retrying =
      error !== null &&
      lastTurn?.role === "user" &&
      lastTurn.content === trimmed;
    const history = (retrying ? turns.slice(0, -1) : turns)
      .slice(-8)
      .map(({ role, content }) => ({
        role,
        content: content.slice(0, MESSAGE_LIMIT),
      }));
    const controller = new AbortController();
    requestRef.current = controller;
    if (!retrying)
      setTurns((prev) =>
        [...prev, { role: "user", content: trimmed } as ChatTurn].slice(
          -TRANSCRIPT_LIMIT,
        ),
      );
    setInput("");
    setError(null);

    startTransition(async () => {
      const clientRequestId = crypto.randomUUID();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      try {
        const { reply } = await requestAssistantChat(
          serializeAssistantChatRequest(trimmed, history), controller.signal, clientRequestId,
        );
        setTurns((prev) =>
          [
            ...prev,
            {
              role: "assistant",
              content: reply.slice(0, MESSAGE_LIMIT),
              shortened: reply.length > MESSAGE_LIMIT,
            } as ChatTurn,
          ].slice(-TRANSCRIPT_LIMIT),
        );
      } catch (err) {
        setInput(trimmed);
        const failure = assistantChatFailure(err, controller.signal.aborted, timedOut);
        setError({ ...failure, requestId: failure.requestId ?? clientRequestId });
      } finally {
        setActionsVersion((value) => value + 1);
        window.clearTimeout(timeout);
        if (requestRef.current === controller) requestRef.current = null;
      }
    });
  }

  return (
    <>
      <button
        ref={toggleRef}
        aria-expanded={open}
        aria-controls="pointup-assistant"
        type="button"
        onClick={() => (open ? closeAssistant() : setOpen(true))}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/40 transition hover:bg-brand-strong"
      >
        {open ? "Close assistant" : "Ask PointUp"}
      </button>

      {open && (
        <section
          id="pointup-assistant"
          aria-label="PointUp Assistant"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeAssistant();
            }
          }}
          className="fixed bottom-20 right-5 z-50 flex h-[min(38rem,calc(100dvh-8rem))] w-[min(28rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-midnight shadow-2xl"
        >
          <header className="shrink-0 border-b border-line bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink">
                PointUp Assistant
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={clearChat}
                  disabled={pending}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-brand disabled:opacity-50"
                >
                  Clear chat
                </button>
                <button
                  type="button"
                  onClick={closeAssistant}
                  aria-label="Close PointUp Assistant"
                  className="rounded-lg px-3 py-2 text-lg leading-none text-ink-muted"
                >
                  ×
                </button>
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              Portfolio advice and changes for your review
            </p>
            <a
              href="/dashboard/agents"
              className="mt-1 inline-block text-xs text-brand underline"
            >
              Manage agent access
            </a>
          </header>

          <div
            ref={messagesRef}
            role="log"
            aria-live="polite"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
          >
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
                {turn.shortened && (
                  <p className="mt-2 text-xs font-medium">
                    Answer shortened. Ask a more specific question for details.
                  </p>
                )}
              </div>
            ))}
            <ReviewedAssistantActions compact refreshKey={actionsVersion} />
            {pending && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-ink-faint">Thinking…</p>
                <button
                  type="button"
                  onClick={() => requestRef.current?.abort()}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted"
                >
                  Stop request
                </button>
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger/20 p-3 text-xs text-danger"
              >
                <p>{error.message}</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setActionsVersion(value => value + 1)}
                    className="rounded-lg border border-line px-3 py-2 font-semibold text-ink-muted disabled:opacity-50"
                  >
                    Refresh proposed changes
                  </button>
                  <a href="/dashboard/agents#review-actions" className="self-center font-semibold text-brand underline">
                    Review changes in PointUp
                  </a>
                </div>
                {error.requestId && (
                  <p className="mt-2 break-all text-ink-muted">
                    Support reference: {error.requestId}
                  </p>
                )}
              </div>
            )}
          </div>

          {turns.length === 1 && !error && (
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-line p-3">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={pending}
                  onClick={() => send(suggestion)}
                  className="min-h-10 rounded-xl border border-line px-3 py-2 text-xs text-ink-muted transition hover:border-brand hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex shrink-0 gap-2 border-t border-line bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              aria-label="Message to PointUp Assistant"
              maxLength={MESSAGE_LIMIT}
              disabled={pending}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your points…"
              className="min-w-0 flex-1 rounded-xl border border-line bg-midnight px-3 py-2 text-sm text-ink outline-none focus:border-brand"
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
