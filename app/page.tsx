"use client";

import {
  ArrowUp,
  Calendar,
  CalendarOff,
  RotateCcw,
  Astroid,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type Journal = {
  id: string;
  createdAt: string;
  content: string;
  showDate: boolean;
  elapsedSeconds: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenPanel = "entries" | "chat" | null;

const STORAGE_KEY = "unfold-journals-v1";
const DURATIONS = [5, 10, 15, 20] as const;
const DEFAULT_DURATION = 10;

function readJournals(): Journal[] {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Journal => {
      if (!item || typeof item !== "object") return false;
      const journal = item as Partial<Journal>;
      return (
        typeof journal.id === "string" &&
        typeof journal.createdAt === "string" &&
        !Number.isNaN(Date.parse(journal.createdAt)) &&
        typeof journal.content === "string" &&
        typeof journal.showDate === "boolean" &&
        typeof journal.elapsedSeconds === "number"
      );
    });
  } catch {
    return [];
  }
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function listDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function playChime() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime;

    function tone(frequency: number, start: number, duration: number) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    }

    tone(523.25, now, 0.35);
    tone(659.25, now + 0.22, 0.45);
    window.setTimeout(() => {
      void context.close();
    }, 900);
  } catch {
    // Chime is optional if audio is unavailable.
  }
}

function preview(content: string) {
  return content.replace(/\s+/g, " ").trim() || "Empty entry";
}

function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function preferSameDayJournal(a: Journal, b: Journal) {
  const aHasContent = a.content.trim().length > 0;
  const bHasContent = b.content.trim().length > 0;
  if (aHasContent !== bHasContent) return aHasContent ? a : b;
  return Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b;
}

function dedupeByLocalDate(journals: Journal[]) {
  const byDate = new Map<string, Journal>();
  for (const journal of journals) {
    const key = localDateKey(journal.createdAt);
    const current = byDate.get(key);
    if (!current) {
      byDate.set(key, journal);
      continue;
    }
    const winner = preferSameDayJournal(current, journal);
    byDate.set(key, {
      ...winner,
      elapsedSeconds: Math.max(current.elapsedSeconds, journal.elapsedSeconds),
    });
  }
  return [...byDate.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function findTodaysJournal(journals: Journal[]) {
  const today = localDateKey(new Date());
  return (
    journals.find((journal) => localDateKey(journal.createdAt) === today) ??
    null
  );
}

function makeJournal(): Journal {
  return {
    id: window.crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    content: "",
    showDate: true,
    elapsedSeconds: 0,
  };
}

function EntryList({
  journals,
  activeId,
  onSelect,
}: {
  journals: Journal[];
  activeId?: string | null;
  onSelect: (id: string) => void;
}) {
  if (!journals.length) return <p className="empty-state">No entries yet.</p>;
  return (
    <div className="entry-list">
      {journals.map((journal) => (
        <button
          className={`entry-row${journal.id === activeId ? " is-active" : ""}`}
          type="button"
          key={journal.id}
          aria-current={journal.id === activeId ? "true" : undefined}
          onClick={() => onSelect(journal.id)}
        >
          <time className="entry-date" dateTime={journal.createdAt}>
            {listDate(journal.createdAt)} ·{" "}
            {new Intl.DateTimeFormat("en", {
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(journal.createdAt))}
          </time>
          <span className="entry-preview">{preview(journal.content)}</span>
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [durationMin, setDurationMin] = useState<number>(DEFAULT_DURATION);
  const [remaining, setRemaining] = useState(DEFAULT_DURATION * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [mobile, setMobile] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const entriesPanelRef = useRef<HTMLElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  const panelButtonRef = useRef<HTMLButtonElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const entriesCloseRef = useRef<HTMLButtonElement>(null);
  const chatCloseRef = useRef<HTMLButtonElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef<HTMLDivElement>(null);
  const durationTriggerRef = useRef<HTMLButtonElement>(null);
  const remainingRef = useRef(DEFAULT_DURATION * 60);
  const panelOpen = openPanel !== null;

  function resetTimerSession(nextDuration = DEFAULT_DURATION) {
    const seconds = nextDuration * 60;
    remainingRef.current = seconds;
    setDurationMin(nextDuration);
    setRemaining(seconds);
    setTimerRunning(false);
    setTimeUp(false);
    setDurationOpen(false);
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const existing = dedupeByLocalDate(readJournals());
      const todaysJournal = findTodaysJournal(existing);
      if (todaysJournal) {
        setJournals(existing);
        setActiveId(todaysJournal.id);
      } else {
        const journal = makeJournal();
        setJournals([journal, ...existing]);
        setActiveId(journal.id);
      }
      const isMobile = window.matchMedia("(max-width: 899px)").matches;
      setMobile(isMobile);
      setOpenPanel(isMobile ? null : "entries");
      setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journals));
    } catch {
      // The editor remains usable if browser storage is unavailable.
    }
  }, [journals, loaded]);

  useEffect(() => {
    if (!timerRunning || !activeId || timeUp) return;
    const interval = window.setInterval(() => {
      const next = remainingRef.current - 1;
      remainingRef.current = Math.max(0, next);
      if (next <= 0) {
        setRemaining(0);
        setTimerRunning(false);
        setTimeUp(true);
        playChime();
      } else {
        setRemaining(next);
      }
      setJournals((current) =>
        current.map((journal) =>
          journal.id === activeId
            ? { ...journal, elapsedSeconds: journal.elapsedSeconds + 1 }
            : journal,
        ),
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeId, timerRunning, timeUp]);

  useEffect(() => {
    if (!durationOpen) return;
    durationRef.current
      ?.querySelector<HTMLButtonElement>(
        '.duration-option[aria-selected="true"]',
      )
      ?.focus();
    function handlePointer(event: MouseEvent) {
      if (
        durationRef.current &&
        !durationRef.current.contains(event.target as Node)
      ) {
        setDurationOpen(false);
      }
    }
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDurationOpen(false);
      durationTriggerRef.current?.focus();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [durationOpen]);

  const activeJournal = journals.find((journal) => journal.id === activeId);
  const sortedJournals = [...journals].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    function updateViewport() {
      const isMobile = query.matches;
      setMobile(isMobile);
      setOpenPanel((current) => {
        if (isMobile) return null;
        return current ?? "entries";
      });
    }
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    function resizeEditor() {
      if (!editor) return;
      editor.style.height = "auto";
      editor.style.height = `${editor.scrollHeight}px`;
    }
    resizeEditor();
    const observer = new ResizeObserver(resizeEditor);
    if (editor.parentElement) observer.observe(editor.parentElement);
    window.addEventListener("resize", resizeEditor);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resizeEditor);
    };
  }, [activeId, activeJournal?.content, panelOpen, mobile]);

  useEffect(() => {
    if (activeId) editorRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    if (!openPanel || !activeId) return;
    const panelRef = openPanel === "entries" ? entriesPanelRef : chatPanelRef;
    const closeRef = openPanel === "entries" ? entriesCloseRef : chatCloseRef;
    const triggerRef = openPanel === "entries" ? panelButtonRef : chatButtonRef;

    if (mobile) closeRef.current?.focus();
    else if (openPanel === "chat") chatInputRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";

    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenPanel(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
      if (mobile && event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled])",
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [openPanel, mobile, activeId]);

  useEffect(() => {
    const list = chatMessagesRef.current;
    if (!list || openPanel !== "chat") return;
    list.scrollTop = list.scrollHeight;
  }, [messages, chatPending, chatError, openPanel]);

  useEffect(() => {
    const input = chatInputRef.current;
    if (!input || openPanel !== "chat") return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [chatInput, openPanel]);

  function openEntriesPanel() {
    setOpenPanel("entries");
    window.requestAnimationFrame(() => entriesCloseRef.current?.focus());
  }

  function openChatPanel() {
    setOpenPanel("chat");
    window.requestAnimationFrame(() => {
      if (mobile) chatCloseRef.current?.focus();
      else chatInputRef.current?.focus();
    });
  }

  function closePanel() {
    const trigger = openPanel === "chat" ? chatButtonRef : panelButtonRef;
    setOpenPanel(null);
    window.requestAnimationFrame(() => trigger.current?.focus());
  }

  function openJournal(id: string) {
    resetTimerSession();
    setActiveId(id);
    if (mobile) setOpenPanel(null);
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }

  function selectDuration(minutes: number) {
    if (timerRunning || timeUp) return;
    remainingRef.current = minutes * 60;
    setDurationMin(minutes);
    setRemaining(minutes * 60);
    setDurationOpen(false);
    durationTriggerRef.current?.focus();
  }

  function resetTimer() {
    resetTimerSession(durationMin);
  }

  function updateContent(content: string) {
    if (!activeId) return;
    if (!timerRunning && !timeUp && remainingRef.current === durationMin * 60) {
      setTimerRunning(true);
      setDurationOpen(false);
    }
    setJournals((current) =>
      current.map((journal) =>
        journal.id === activeId ? { ...journal, content } : journal,
      ),
    );
  }

  function toggleTimer() {
    if (timeUp || remaining >= durationMin * 60) return;
    setTimerRunning((running) => !running);
  }

  function toggleDate() {
    setJournals((current) =>
      current.map((journal) =>
        journal.id === activeId
          ? { ...journal, showDate: !journal.showDate }
          : journal,
      ),
    );
  }

  async function sendChatMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = chatInput.trim();
    if (!content || chatPending || !activeJournal) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content },
    ];
    setMessages(nextMessages);
    setChatInput("");
    setChatError(null);
    setChatPending(true);

    try {
      const response = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          text: activeJournal.content,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Something went wrong.";
        throw new Error(error);
      }
      const reply =
        data &&
        typeof data === "object" &&
        "reply" in data &&
        typeof (data as { reply: unknown }).reply === "string"
          ? (data as { reply: string }).reply.trim()
          : "";
      if (!reply) throw new Error("Empty reply from companion.");
      setMessages((current) => [
        ...current,
        { role: "assistant", content: reply },
      ]);
    } catch (reason) {
      setChatError(
        reason instanceof Error ? reason.message : "Something went wrong.",
      );
    } finally {
      setChatPending(false);
    }
  }

  function handleChatKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendChatMessage();
    }
  }

  if (!loaded) return <div className="app-shell" aria-busy="true" />;

  if (activeJournal) {
    const timerStarted = timerRunning || timeUp || remaining < durationMin * 60;
    const entriesOpen = openPanel === "entries";
    const chatOpen = openPanel === "chat";

    return (
      <div
        className={`app-shell writing-screen${panelOpen ? " panel-open" : ""}`}
      >
        <div className="writing-workspace" inert={mobile && panelOpen}>
          <header className="writing-header">
            <button
              ref={panelButtonRef}
              className={`text-button panel-toggle${entriesOpen ? " is-hidden" : ""}`}
              type="button"
              aria-expanded={entriesOpen}
              aria-controls="entries-panel"
              aria-hidden={entriesOpen}
              tabIndex={entriesOpen ? -1 : 0}
              onClick={openEntriesPanel}
            >
              Entries
            </button>
          </header>
          <main className="writing-main">
            <div className="writing-column">
              <h1
                className={`writing-date${activeJournal.showDate ? "" : " is-hidden"}`}
                aria-hidden={!activeJournal.showDate}
              >
                <time dateTime={activeJournal.createdAt}>
                  {fullDate(activeJournal.createdAt)}
                </time>
              </h1>
              <textarea
                ref={editorRef}
                className="writing-editor"
                aria-label="Journal entry"
                placeholder="Begin writing…"
                spellCheck
                value={activeJournal.content}
                onChange={(event) => updateContent(event.target.value)}
              />
            </div>
          </main>
          <footer className="writing-footer">
            <div className="footer-inner">
              <div className="timer-group">
                {!timerStarted ? (
                  <div
                    className={`duration-picker${durationOpen ? " is-open" : ""}`}
                    ref={durationRef}
                  >
                    <button
                      ref={durationTriggerRef}
                      className="timer duration-trigger"
                      type="button"
                      aria-expanded={durationOpen}
                      aria-haspopup="listbox"
                      aria-controls="duration-menu"
                      aria-label={`Session length ${durationMin} minutes`}
                      title="Session length"
                      tabIndex={durationOpen ? -1 : 0}
                      onClick={() => setDurationOpen(true)}
                    >
                      {formatTime(durationMin * 60)}
                    </button>
                    <div
                      id="duration-menu"
                      className="duration-menu"
                      role="listbox"
                      aria-label="Session length"
                      aria-hidden={!durationOpen}
                    >
                      {DURATIONS.map((minutes) => (
                        <button
                          key={minutes}
                          className={`timer duration-option${durationMin === minutes ? " is-active" : ""}`}
                          type="button"
                          role="option"
                          aria-selected={durationMin === minutes}
                          tabIndex={durationOpen ? 0 : -1}
                          onClick={() => selectDuration(minutes)}
                        >
                          {minutes}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : timeUp ? (
                  <>
                    <span className="timer" aria-live="polite">
                      Time&apos;s up
                    </span>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Reset timer"
                      title="Reset timer"
                      onClick={resetTimer}
                    >
                      <RotateCcw size={14} strokeWidth={1.5} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={`timer${timerRunning ? "" : " is-paused"}`}
                      type="button"
                      aria-pressed={timerRunning}
                      aria-label={
                        timerRunning
                          ? `Pause timer, ${formatTime(remaining)} remaining`
                          : `Resume timer, ${formatTime(remaining)} remaining`
                      }
                      title={timerRunning ? "Pause" : "Resume"}
                      onClick={toggleTimer}
                    >
                      {formatTime(remaining)}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Reset timer"
                      title="Reset timer"
                      onClick={resetTimer}
                    >
                      <RotateCcw size={14} strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
              <div className="footer-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-pressed={activeJournal.showDate}
                  aria-label="Toggle date"
                  title={activeJournal.showDate ? "Hide date" : "Show date"}
                  onClick={toggleDate}
                >
                  {activeJournal.showDate ? (
                    <Calendar size={16} strokeWidth={1.5} />
                  ) : (
                    <CalendarOff size={16} strokeWidth={1.5} />
                  )}
                </button>
                <button
                  ref={chatButtonRef}
                  className={`icon-button${chatOpen ? " is-active" : ""}`}
                  type="button"
                  aria-expanded={chatOpen}
                  aria-controls="chat-panel"
                  aria-label={chatOpen ? "Close companion" : "Open companion"}
                  title="Companion"
                  onClick={() => (chatOpen ? closePanel() : openChatPanel())}
                >
                  <Astroid size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </footer>
        </div>
        <div
          className={`panel-backdrop${panelOpen ? " is-open" : ""}`}
          onClick={closePanel}
          aria-hidden="true"
        />
        <aside
          id="entries-panel"
          className={`side-panel${entriesOpen ? " is-open" : ""}`}
          ref={entriesPanelRef}
          inert={!entriesOpen}
          aria-hidden={!entriesOpen}
          role={mobile ? "dialog" : undefined}
          aria-modal={mobile && entriesOpen ? true : undefined}
          aria-labelledby="panel-heading"
        >
          <div className="panel-header">
            <h2 id="panel-heading">Entries</h2>
            <button
              ref={entriesCloseRef}
              className="icon-button close-button"
              type="button"
              aria-label="Close entries panel"
              onClick={closePanel}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          <EntryList
            journals={sortedJournals}
            activeId={activeId}
            onSelect={openJournal}
          />
        </aside>
        <aside
          id="chat-panel"
          className={`side-panel chat-panel${chatOpen ? " is-open" : ""}`}
          ref={chatPanelRef}
          inert={!chatOpen}
          aria-hidden={!chatOpen}
          role={mobile ? "dialog" : undefined}
          aria-modal={mobile && chatOpen ? true : undefined}
          aria-labelledby="chat-heading"
        >
          <div className="panel-header">
            <h2 id="chat-heading">Companion</h2>
            <button
              ref={chatCloseRef}
              className="icon-button close-button"
              type="button"
              aria-label="Close companion panel"
              onClick={closePanel}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          <div
            className="chat-messages"
            ref={chatMessagesRef}
            aria-live="polite"
          >
            {!messages.length && !chatPending && !chatError ? (
              <p className="empty-state">Ask about what you&apos;re writing.</p>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`chat-message is-${message.role}`}
              >
                {message.content}
              </div>
            ))}
            {chatPending ? (
              <div className="chat-message is-assistant is-pending">
                Thinking…
              </div>
            ) : null}
            {chatError ? (
              <p className="chat-error" role="alert">
                {chatError}
              </p>
            ) : null}
          </div>
          <form className="chat-composer" onSubmit={sendChatMessage}>
            <textarea
              ref={chatInputRef}
              className="chat-input"
              rows={1}
              aria-label="Message companion"
              placeholder="Ask something…"
              value={chatInput}
              disabled={chatPending}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={handleChatKeyDown}
            />
            <button
              className="chat-send"
              type="submit"
              aria-label="Send message"
              disabled={chatPending || !chatInput.trim()}
            >
              <ArrowUp size={16} strokeWidth={1.75} />
            </button>
          </form>
        </aside>
      </div>
    );
  }

  return (
    <div className="app-shell home-screen">
      <main className="home-main">
        <header className="home-header">
          <h1>Entries</h1>
        </header>
        <EntryList journals={sortedJournals} onSelect={openJournal} />
      </main>
    </div>
  );
}
