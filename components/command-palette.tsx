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
  initialText: string;
  onCreate: (text: string) => void;
  onOpenNote: (id: string) => void;
  onClose: (text: string) => void;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

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
  initialText,
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
  const [query, setQuery] = useState(initialText);
  const [activeIndex, setActiveIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [askError, setAskError] = useState("");
  const [asking, setAsking] = useState(false);
  const terms = useMemo(() => query.toLowerCase().trim().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => notes
    .filter((note) => terms.every((term) => note.text.toLowerCase().includes(term)))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, terms.length ? 8 : 3), [notes, terms]);
  const askIndex = results.length + 1;
  const selectedIndex = Math.min(activeIndex, askIndex);
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
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, results]);

  function close() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    requestRef.current?.abort();
    onClose(query);
  }

  function run(index: number) {
    if (finishedRef.current) return;
    if (index === askIndex) {
      void askNotes();
      return;
    }
    finishedRef.current = true;
    requestRef.current?.abort();
    if (index === 0) onCreate(query);
    else onOpenNote(results[index - 1].id);
  }

  async function askNotes() {
    if (!query.trim() || asking || !notes.length) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setAnswer("");
    setAskError("");
    setAsking(true);
    try {
      const response = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "notes",
          text: JSON.stringify(notes.map(({ text, updatedAt }) => ({ text, updatedAt }))),
          messages: [{ role: "user", content: query.trim() }],
        }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("Unable to answer");
      }
      if (!controller.signal.aborted) setAnswer(data.reply);
    } catch {
      if (!controller.signal.aborted) setAskError("Couldn't reach AI. Try asking again.");
    } finally {
      if (!controller.signal.aborted) setAsking(false);
    }
  }

  function changeQuery(text: string) {
    requestRef.current?.abort();
    setQuery(text);
    setActiveIndex(0);
    setAnswer("");
    setAskError("");
    setAsking(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isPresent || event.nativeEvent.isComposing) return;
    if (event.key === "Escape" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey)) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(0, Math.min(askIndex, selectedIndex + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      run(selectedIndex);
    } else if (event.key === "Tab") {
      event.preventDefault();
      textareaRef.current?.focus();
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
        aria-disabled={index === askIndex ? !query.trim() || !notes.length || asking : undefined}
        className="command-palette-row"
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
        aria-label="Create, find, or ask your notes"
        onKeyDown={handleKeyDown}
        initial={{ opacity: 0, scale: 0.985, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        <textarea
          ref={textareaRef}
          className="command-palette-input"
          role="combobox"
          aria-label="Write, find, or ask your notes"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={optionId(selectedIndex)}
          placeholder="Unfold a thought…"
          rows={1}
          spellCheck
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
        />
        <div className="command-palette-separator" />
        <LayoutGroup id={id}>
          <div ref={listRef} id={`${id}-list`} className="command-palette-list" role="listbox" aria-label="Note actions">
            {row(0, "New note", "↵")}
            <div role="group" aria-labelledby={`${id}-notes`}>
              <div id={`${id}-notes`} className="command-palette-section">notes</div>
              {results.length === 0 ? <div className="command-palette-hint">{terms.length ? "No matching notes" : "Your notes will appear here"}</div> : null}
              {results.map((note, index) => row(index + 1,
                matchedTitle(note.text.split(/\r?\n/)[0], terms),
                <time dateTime={note.updatedAt}>{dateFormatter.format(new Date(note.updatedAt))}</time>))}
            </div>
            <div role="group" aria-labelledby={`${id}-ask`}>
              <div id={`${id}-ask`} className="command-palette-section">ask</div>
              {row(askIndex, "Ask your notes", asking ? "Thinking…" : "AI")}
            </div>
          </div>
        </LayoutGroup>
        {asking || answer || askError ? (
          <div className="command-palette-answer" role="status" aria-live="polite" aria-busy={asking}>
            {asking ? "Thinking about your notes…" : askError || answer}
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  );
}
