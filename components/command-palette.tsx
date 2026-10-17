import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LayoutGroup,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";

import type { Note } from "@/lib/notes";

type CommandPaletteProps = {
  notes: Note[];
  onCreate: (text: string) => void;
  onOpenNote: (id: string) => void;
  onClose: () => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type StreamDraft = {
  id: string;
  content: string;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

const ASK_PREFIX = /^\s*(?:ask|ai)(?=\s|$)\s*/i;

function matchedTitle(title: string, terms: string[]) {
  if (!terms.length) return title;
  const lower = title.toLowerCase();
  const matched = new Array<boolean>(title.length).fill(false);
  for (const term of terms) {
    let start = lower.indexOf(term);
    while (start !== -1) {
      for (let i = start; i < start + term.length; i += 1) matched[i] = true;
      start = lower.indexOf(term, start + 1);
    }
  }
  const fragments = [];
  for (let start = 0; start < title.length; ) {
    let end = start + 1;
    while (end < title.length && matched[end] === matched[start]) end += 1;
    fragments.push(
      matched[start] ? (
        <mark key={start} className="command-palette-match">
          {title.slice(start, end)}
        </mark>
      ) : (
        title.slice(start, end)
      ),
    );
    start = end;
  }
  return fragments;
}

export default function CommandPalette({
  notes,
  onCreate,
  onOpenNote,
  onClose,
}: CommandPaletteProps) {
  const id = useId();
  const isPresent = useIsPresent();
  const shouldReduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const renderFrameRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [askMode, setAskMode] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [askError, setAskError] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<StreamDraft | null>(null);
  const [submitPulse, setSubmitPulse] = useState(0);
  const showConversation = messages.length > 0;
  const terms = useMemo(
    () => query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    [query],
  );
  const results = useMemo(
    () =>
      askMode
        ? []
        : notes
            .filter((note) =>
              terms.every((term) => note.text.toLowerCase().includes(term)),
            )
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, terms.length ? 8 : 3),
    [notes, terms, askMode],
  );
  const askIndex = results.length + 1;
  const hasAskPrefix = ASK_PREFIX.test(query);
  const selectedIndex = askMode
    ? askIndex
    : Math.min(activeIndex ?? (hasAskPrefix ? askIndex : 0), askIndex);
  const prompt = (askMode ? query : query.replace(ASK_PREFIX, "")).trim();
  const sendDisabled = !prompt || asking || !!askError;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(
    () => () => {
      requestRef.current?.abort();
      if (renderFrameRef.current !== null)
        cancelAnimationFrame(renderFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const canvas = textarea.closest<HTMLElement>(".canvas-shell");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    return () => {
      if (
        document.activeElement === textarea ||
        document.activeElement === document.body
      ) {
        canvas?.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [query, askMode]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, results]);

  function close() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    requestRef.current?.abort();
    if (renderFrameRef.current !== null)
      cancelAnimationFrame(renderFrameRef.current);
    onClose();
  }

  function run(index: number) {
    if (finishedRef.current || !isPresent) return;
    if (index === askIndex) {
      if (!askMode) enterAskMode();
      if (!prompt || asking || askError || requestRef.current) return;
      setSubmitPulse((current) => current + 1);
      void askAI(prompt);
      return;
    }
    finishedRef.current = true;
    requestRef.current?.abort();
    if (index === 0) onCreate(query);
    else onOpenNote(results[index - 1].id);
  }

  async function askAI(text: string, retry = false) {
    if (!text || requestRef.current || finishedRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const nextMessages: ChatMessage[] = retry
      ? messages
      : [...messages, { id: crypto.randomUUID(), role: "user", content: text }];
    if (!retry) {
      setMessages(nextMessages);
      setQuery("");
    }
    const draftId = crypto.randomUUID();
    setDraft({ id: draftId, content: "" });
    setAskError("");
    setAsking(true);
    textareaRef.current?.focus({ preventScroll: true });
    try {
      const response = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "ask",
          stream: true,
          messages: nextMessages
            .slice(-19)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error("Unable to answer");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";
      const publish = () => {
        renderFrameRef.current = null;
        if (!controller.signal.aborted && requestRef.current === controller) {
          setDraft({ id: draftId, content: received });
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
        if (renderFrameRef.current === null) {
          renderFrameRef.current = requestAnimationFrame(publish);
        }
      }
      received += decoder.decode();
      const reply = received.trim();
      if (!reply) throw new Error("Unable to answer");
      if (!controller.signal.aborted && requestRef.current === controller) {
        setMessages([
          ...nextMessages,
          { id: draftId, role: "assistant", content: reply },
        ]);
        setDraft(null);
      }
    } catch {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setDraft(null);
        setAskError("Couldn't reach AI.");
      }
    } finally {
      if (
        requestRef.current === controller &&
        renderFrameRef.current !== null
      ) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      if (!controller.signal.aborted && requestRef.current === controller) {
        requestRef.current = null;
        setAsking(false);
      }
    }
  }

  function changeQuery(text: string) {
    setQuery(text);
    setActiveIndex(null);
  }

  function enterAskMode() {
    changeQuery(query.replace(ASK_PREFIX, ""));
    setAskMode(true);
    textareaRef.current?.focus();
  }

  function exitAskMode() {
    requestRef.current?.abort();
    requestRef.current = null;
    setAsking(false);
    setAskError("");
    setMessages([]);
    setDraft(null);
    if (renderFrameRef.current !== null) {
      cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    }
    setAskMode(false);
    setActiveIndex(null);
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isPresent || event.nativeEvent.isComposing) return;
    const inInput = event.target === textareaRef.current;
    if (
      event.key === "Escape" ||
      (event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      if (
        inInput &&
        !showConversation &&
        ((!askMode && !event.shiftKey && selectedIndex === askIndex) ||
          (askMode && event.shiftKey))
      ) {
        event.preventDefault();
        if (askMode) exitAskMode();
        else enterAskMode();
        return;
      }
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea, a[href], [tabindex="0"]',
        ) ?? [],
      );
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next =
        (current + (event.shiftKey ? -1 : 1) + focusable.length) %
        focusable.length;
      event.preventDefault();
      focusable[next]?.focus({ preventScroll: true });
    } else if (!inInput) {
      return;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (askMode) return;
      event.preventDefault();
      setActiveIndex(
        Math.max(
          0,
          Math.min(
            askIndex,
            selectedIndex + (event.key === "ArrowDown" ? 1 : -1),
          ),
        ),
      );
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) run(selectedIndex);
    } else if (
      event.key === "Backspace" &&
      askMode &&
      !query &&
      !showConversation
    ) {
      event.preventDefault();
      exitAskMode();
    }
  }

  function row(index: number, label: ReactNode, meta: ReactNode) {
    const active = selectedIndex === index;
    return (
      <div
        key={
          index === 0
            ? "new"
            : index === askIndex
              ? "ask"
              : results[index - 1].id
        }
        id={optionId(index)}
        role="option"
        aria-selected={active}
        aria-disabled={index === askIndex ? askMode && sendDisabled : undefined}
        className={`command-palette-row${index === askIndex ? " is-ask" : ""}`}
        onPointerMove={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => run(index)}
      >
        {active ? (
          <motion.div
            className="command-palette-highlight"
            layoutId={`${id}-highlight`}
            aria-hidden="true"
          />
        ) : null}
        <span className="command-palette-row-title">{label}</span>
        <span className="command-palette-row-meta">{meta}</span>
      </div>
    );
  }

  return (
    <motion.div
      className="command-palette-scrim"
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <motion.div
        ref={panelRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Create or find notes, or ask AI"
        onKeyDown={handleKeyDown}
        initial={{
          opacity: 0,
          scale: shouldReduceMotion ? 1 : 0.985,
          y: shouldReduceMotion ? 0 : 4,
        }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        <div className="command-palette-input-row">
          {submitPulse > 0 ? (
            <span key={submitPulse} className="command-palette-submit-pulse" aria-hidden="true" />
          ) : null}
          {askMode ? (
            <motion.button
              type="button"
              className="command-palette-ask-pill"
              onClick={exitAskMode}
              aria-label="Exit Ask mode"
              title="Exit Ask mode"
              initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16 }}
            >
              Ask <span aria-hidden="true">×</span>
            </motion.button>
          ) : null}
          <textarea
            ref={textareaRef}
            className="command-palette-input"
            role={showConversation ? undefined : "combobox"}
            aria-label={askMode ? "Ask AI" : "Write, find, or ask AI"}
            aria-expanded={showConversation ? undefined : true}
            aria-autocomplete={showConversation ? undefined : "list"}
            aria-controls={showConversation ? undefined : `${id}-list`}
            aria-activedescendant={
              showConversation ? undefined : optionId(selectedIndex)
            }
            placeholder={
              askMode
                ? messages.length
                  ? "Continue the thought…"
                  : "Ask anything…"
                : "Unfold a thought…"
            }
            rows={1}
            spellCheck
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </div>
        {!showConversation ? (
          <>
            <div className="command-palette-separator" />
            <LayoutGroup id={id}>
              <div
                ref={listRef}
                id={`${id}-list`}
                className="command-palette-list"
                role="listbox"
                aria-label="Note actions"
              >
                {!askMode ? (
                  <>
                    {row(0, "New note", <kbd>↵</kbd>)}
                    <div role="group" aria-labelledby={`${id}-notes`}>
                      <div
                        id={`${id}-notes`}
                        className="command-palette-section"
                      >
                        notes
                      </div>
                      {results.length === 0 ? (
                        <div className="command-palette-hint">
                          {terms.length
                            ? "No matching notes"
                            : "Your notes will appear here"}
                        </div>
                      ) : null}
                      {results.map((note, index) =>
                        row(
                          index + 1,
                          matchedTitle(note.text.split(/\r?\n/)[0], terms),
                          <time dateTime={note.updatedAt}>
                            {dateFormatter.format(new Date(note.updatedAt))}
                          </time>,
                        ),
                      )}
                    </div>
                  </>
                ) : null}
                <div role="group" aria-labelledby={`${id}-ask`}>
                  <div id={`${id}-ask`} className="command-palette-section">
                    ask
                  </div>
                  {row(
                    askIndex,
                    "Ask AI",
                    askMode ? (
                      <>
                        <kbd>↵</kbd> to send
                      </>
                    ) : hasAskPrefix ? (
                      <>
                        <kbd>Tab</kbd> to ask
                      </>
                    ) : (
                      "AI"
                    ),
                  )}
                </div>
              </div>
            </LayoutGroup>
          </>
        ) : null}
        {showConversation ? (
          <div className="command-palette-conversation">
            <div className="command-palette-transcript-frame">
              <div
                id={`${id}-transcript`}
                className="command-palette-transcript"
                role="log"
                aria-label="Conversation"
                aria-live="off"
                aria-busy={asking}
                tabIndex={0}
              >
                <div
                  className="command-palette-transcript-content"
                >
                  {[
                    ...messages,
                    ...(draft
                      ? [{ ...draft, role: "assistant" as const }]
                      : []),
                  ].map((message) => (
                    <motion.div
                      key={message.id}
                      className={`command-palette-message is-${message.role}`}
                      role="group"
                      aria-label={message.role === "user" ? "You" : "Assistant"}
                      initial={{
                        opacity: 0,
                        y: shouldReduceMotion
                          ? 0
                          : message.role === "user"
                            ? -10
                            : 3,
                      }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
                    >
                      {message.role === "user" ? (
                        <div className="command-palette-message-content">
                          {message.content}
                        </div>
                      ) : message.content ? (
                        <div className="command-palette-message-content">
                          {message.content}
                        </div>
                      ) : (
                        <div className="command-palette-pending">Thinking…</div>
                      )}
                    </motion.div>
                  ))}
                  {askError ? (
                    <div className="command-palette-error">
                      <span>{askError}</span>
                      <button
                        type="button"
                        className="command-palette-retry"
                        onClick={() => {
                          if (requestRef.current) return;
                          setSubmitPulse((current) => current + 1);
                          void askAI(
                            messages[messages.length - 1].content,
                            true,
                          );
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div
          className="command-palette-sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {asking
            ? "Thinking…"
            : askError
              ? "Couldn't reach AI. Retry is available."
              : messages.at(-1)?.role === "assistant"
                ? `Assistant: ${messages.at(-1)?.content}`
                : ""}
        </div>
      </motion.div>
    </motion.div>
  );
}
