import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { LayoutGroup, motion, useIsPresent } from "motion/react";

import type { Note } from "@/lib/notes";

type CommandPaletteProps = {
  notes: Note[];
  onCreate: (text: string) => void;
  onOpenNote: (id: string) => void;
  onClose: () => void;
};

type ChatMessage = {
  role: "user" | "assistant";
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
  for (let start = 0; start < title.length;) {
    let end = start + 1;
    while (end < title.length && matched[end] === matched[start]) end += 1;
    fragments.push(matched[start]
      ? <mark key={start} className="command-palette-match">{title.slice(start, end)}</mark>
      : title.slice(start, end));
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [askMode, setAskMode] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [askError, setAskError] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [submitPulse, setSubmitPulse] = useState(0);
  const showAnswer = asking || !!answer || !!askError;
  const terms = useMemo(() => query.toLowerCase().trim().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => askMode ? [] : notes
    .filter((note) => terms.every((term) => note.text.toLowerCase().includes(term)))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, terms.length ? 8 : 3), [notes, terms, askMode]);
  const askIndex = results.length + 1;
  const hasAskPrefix = ASK_PREFIX.test(query);
  const selectedIndex = askMode ? askIndex : Math.min(activeIndex ?? (hasAskPrefix ? askIndex : 0), askIndex);
  const prompt = askMode ? query.trim() : query.replace(ASK_PREFIX, "").trim();
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const canvas = textarea.closest<HTMLElement>(".canvas-shell");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    return () => {
      if (document.activeElement === textarea || document.activeElement === document.body) {
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
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, results]);

  function close() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    requestRef.current?.abort();
    onClose();
  }

  function run(index: number) {
    if (finishedRef.current) return;
    if (index === askIndex) {
      if (!askMode) enterAskMode();
      void askAI(prompt);
      return;
    }
    finishedRef.current = true;
    requestRef.current?.abort();
    if (index === 0) onCreate(query);
    else onOpenNote(results[index - 1].id);
  }

  async function askAI(text: string) {
    if (!text || asking || (requestRef.current && !requestRef.current.signal.aborted)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const nextMessages: ChatMessage[] = [
      ...messages.slice(-18),
      { role: "user", content: text },
    ];
    setAskError("");
    setAsking(true);
    setSubmitPulse((current) => current + 1);
    try {
      const response = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "ask",
          messages: nextMessages,
        }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("Unable to answer");
      }
      if (!controller.signal.aborted) {
        setAnswer(data.reply);
        setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
        setQuery("");
        textareaRef.current?.focus();
      }
    } catch {
      if (!controller.signal.aborted) setAskError("Couldn't reach AI. Try asking again.");
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setAsking(false);
      }
    }
  }

  function changeQuery(text: string) {
    requestRef.current?.abort();
    setQuery(text);
    setActiveIndex(null);
    setAskError("");
    setAsking(false);
  }

  function enterAskMode() {
    changeQuery(query.replace(ASK_PREFIX, ""));
    setAskMode(true);
    textareaRef.current?.focus();
  }

  function exitAskMode() {
    changeQuery(query);
    setAnswer("");
    setMessages([]);
    setAskMode(false);
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isPresent || event.nativeEvent.isComposing) return;
    if (event.key === "Escape" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey)) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (askMode) return;
      event.preventDefault();
      setActiveIndex(Math.max(0, Math.min(askIndex, selectedIndex + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      run(selectedIndex);
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (askMode && event.shiftKey) exitAskMode();
      else if (!askMode && !event.shiftKey && selectedIndex === askIndex) enterAskMode();
      textareaRef.current?.focus();
    } else if (event.key === "Backspace" && askMode && !query) {
      event.preventDefault();
      exitAskMode();
    }
  }

  function row(index: number, label: ReactNode, meta: ReactNode) {
    const active = selectedIndex === index;
    return (
      <div
        key={index === 0 ? "new" : index === askIndex ? "ask" : results[index - 1].id}
        id={optionId(index)}
        role="option"
        aria-selected={active}
        aria-disabled={index === askIndex ? (askMode && !prompt) || asking : undefined}
        className={`command-palette-row${index === askIndex ? " is-ask" : ""}`}
        onPointerMove={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => run(index)}
      >
        {active ? <motion.div className="command-palette-highlight" layoutId={`${id}-highlight`} aria-hidden="true" /> : null}
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
      onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <motion.div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Create or find notes, or ask AI"
        onKeyDown={handleKeyDown}
        initial={{ opacity: 0, scale: 0.985, y: 4 }}
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
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16 }}
            >
              Ask <span aria-hidden="true">×</span>
            </motion.button>
          ) : null}
          <textarea
            ref={textareaRef}
            className="command-palette-input"
            role="combobox"
            aria-label={askMode ? "Ask AI" : "Write, find, or ask AI"}
            aria-expanded={!showAnswer}
            aria-autocomplete={showAnswer ? undefined : "list"}
            aria-controls={showAnswer ? undefined : `${id}-list`}
            aria-activedescendant={showAnswer ? undefined : optionId(selectedIndex)}
            placeholder={askMode ? messages.length ? "Chat more with the response…" : "Ask anything…" : "Unfold a thought…"}
            rows={1}
            spellCheck
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </div>
        {!showAnswer ? (
          <>
            <div className="command-palette-separator" />
            <LayoutGroup id={id}>
              <div ref={listRef} id={`${id}-list`} className="command-palette-list" role="listbox" aria-label="Note actions">
                {!askMode ? (
                  <>
                    {row(0, "New note", "↵")}
                    <div role="group" aria-labelledby={`${id}-notes`}>
                      <div id={`${id}-notes`} className="command-palette-section">notes</div>
                      {results.length === 0 ? <div className="command-palette-hint">{terms.length ? "No matching notes" : "Your notes will appear here"}</div> : null}
                      {results.map((note, index) => row(index + 1,
                        matchedTitle(note.text.split(/\r?\n/)[0], terms),
                        <time dateTime={note.updatedAt}>{dateFormatter.format(new Date(note.updatedAt))}</time>))}
                    </div>
                  </>
                ) : null}
                <div role="group" aria-labelledby={`${id}-ask`}>
                  <div id={`${id}-ask`} className="command-palette-section">ask</div>
                  {row(askIndex, "Ask AI", askMode ? "↵ Send" : hasAskPrefix ? <><kbd>Tab</kbd> to ask</> : "AI")}
                </div>
              </div>
            </LayoutGroup>
          </>
        ) : null}
        {showAnswer ? (
          <div className="command-palette-answer" role="status" aria-live="polite" aria-busy={asking}>
            {asking ? "Thinking…" : askError || answer}
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  );
}
