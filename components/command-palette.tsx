import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useAnimationControls,
  useIsPresent,
  useReducedMotion,
} from "motion/react";

import { useStickToBottom } from "use-stick-to-bottom";

import AssistantResponse from "@/components/assistant-response";
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

type ScrollHold = {
  pinned: boolean;
  anchor: Element | null;
  offset: number;
};

function captureScroll(
  transcript: HTMLElement,
  content: HTMLElement,
  pinned: boolean,
): ScrollHold {
  if (pinned) return { pinned, anchor: null, offset: 0 };
  const top = transcript.getBoundingClientRect().top;
  for (const element of content.querySelectorAll("*")) {
    const offset = element.getBoundingClientRect().top - top;
    if (offset >= 0) return { pinned, anchor: element, offset };
  }
  return { pinned, anchor: null, offset: 0 };
}

// Reflowing to a new width moves text, so readers keep their place by anchoring
// to the first visible block rather than to a raw scroll offset.
function restoreScroll(transcript: HTMLElement, hold: ScrollHold) {
  if (hold.pinned) {
    transcript.scrollTop = transcript.scrollHeight;
  } else if (hold.anchor?.isConnected) {
    transcript.scrollTop +=
      hold.anchor.getBoundingClientRect().top -
      transcript.getBoundingClientRect().top -
      hold.offset;
  }
}

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
  const panelControls = useAnimationControls();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const resizeAnimationsRef = useRef<Animation[]>([]);
  const resizeOriginRef = useRef<{
    width: number;
    height: number;
    top: string;
  } | null>(null);
  const {
    scrollRef,
    contentRef,
    scrollToBottom,
    isAtBottom,
    stopScroll,
    state: stickState,
  } = useStickToBottom({
    initial: "instant",
    resize: shouldReduceMotion ? "instant" : "smooth",
  });
  const scrollHoldRef = useRef<ScrollHold | null>(null);
  const keyRef = useRef<HTMLButtonElement>(null);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [submitPulse, setSubmitPulse] = useState<{
    id: number;
    x: number;
    y: number;
    size: number;
    start: number;
    duration: number;
  } | null>(null);
  const [sendPressed, setSendPressed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [heldLatest, setHeldLatest] = useState<boolean | null>(null);
  const showLatest = heldLatest ?? !isAtBottom;
  const [conversationOverflows, setConversationOverflows] = useState(false);
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
      if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (renderFrameRef.current !== null)
        cancelAnimationFrame(renderFrameRef.current);
      resizeAnimationsRef.current.forEach((animation) => animation.cancel());
      stopScroll();
    },
    [stopScroll],
  );

  useEffect(() => {
    void panelControls.start({
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: shouldReduceMotion ? 0 : 0.18 },
    });
  }, [panelControls, shouldReduceMotion]);

  useLayoutEffect(() => {
    const origin = resizeOriginRef.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!origin || !panel || !scrim) return;
    resizeOriginRef.current = null;
    resizeAnimationsRef.current.forEach((animation) => animation.cancel());
    resizeAnimationsRef.current = [];
    scrollRef.current?.style.removeProperty("max-height");
    const releaseScroll = () => {
      const hold = scrollHoldRef.current;
      const transcript = scrollRef.current;
      transcript?.style.removeProperty("max-height");
      if (!hold) return;
      if (transcript) restoreScroll(transcript, hold);
      scrollHoldRef.current = null;
      setHeldLatest(null);
      if (hold.pinned) void scrollToBottom("instant");
      else if (stickState.isAtBottom) stopScroll();
    };
    if (shouldReduceMotion) {
      releaseScroll();
      return;
    }

    // Measure the new CSS layout before animating real dimensions, so text stays
    // crisp and the scroll container responds throughout the resize.
    const target = panel.getBoundingClientRect();
    const timing = { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
    const resize = panel.animate(
      {
        width: [`${origin.width}px`, `${target.width}px`],
        height: [`${origin.height}px`, `${target.height}px`],
        maxHeight: [`${origin.height}px`, `${target.height}px`],
      },
      timing,
    );
    resizeAnimationsRef.current = [
      scrim.animate(
        { paddingTop: [origin.top, getComputedStyle(scrim).paddingTop] },
        timing,
      ),
      resize,
    ];
    const transcript = scrollRef.current;
    // The collapsed cap would snap the transcript ahead of the panel; let it
    // follow the animated panel height until the resize settles.
    transcript?.style.setProperty("max-height", "none");
    if (transcript && scrollHoldRef.current) {
      restoreScroll(transcript, scrollHoldRef.current);
    }
    const settle = () => {
      // A newer toggle replaces this animation and inherits the hold.
      if (resizeAnimationsRef.current.includes(resize)) releaseScroll();
    };
    resize.finished.then(settle, settle);
  }, [
    expanded,
    shouldReduceMotion,
    scrollRef,
    scrollToBottom,
    stopScroll,
    stickState,
  ]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const scrim = scrimRef.current;
      if (!scrim) return;
      resizeAnimationsRef.current.forEach((animation) => animation.cancel());
      scrim.style.setProperty(
        "--palette-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      scrim.style.setProperty(
        "--palette-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "0";
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  useEffect(() => {
    const transcript = scrollRef.current;
    const content = contentRef.current;
    if (!transcript || !content) {
      setConversationOverflows(false);
      return;
    }
    const updateOverflow = () => {
      setConversationOverflows(
        transcript.scrollHeight > transcript.clientHeight + 1,
      );
    };
    const observer = new ResizeObserver(() => {
      updateOverflow();
      const hold = scrollHoldRef.current;
      if (hold) {
        if (!hold.pinned && stickState.isAtBottom) stopScroll();
        restoreScroll(transcript, hold);
        return;
      }
      void scrollToBottom({
        preserveScrollPosition: true,
        animation: "instant",
      });
    });
    observer.observe(transcript);
    observer.observe(content);
    updateOverflow();
    return () => observer.disconnect();
  }, [
    showConversation,
    contentRef,
    scrollRef,
    scrollToBottom,
    stopScroll,
    stickState,
  ]);

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
    stopScroll();
    onClose();
  }

  function pulse(origin?: { clientX: number; clientY: number }) {
    const panel = panelRef.current?.getBoundingClientRect();
    // Keyboard submits radiate from the key they stand in for, not the caret.
    const source = (
      askMode
        ? keyRef.current
        : listRef.current?.querySelector(
            '[aria-selected="true"] .command-palette-row-meta',
          )
    )?.getBoundingClientRect();
    if (!panel || !source) return;
    const x = origin
      ? origin.clientX - panel.left
      : source.left + source.width / 2 - panel.left;
    const y = origin
      ? origin.clientY - panel.top
      : source.top + source.height / 2 - panel.top;
    const size =
      2 *
      Math.hypot(Math.max(x, panel.width - x), Math.max(y, panel.height - y));
    // Longer travel gets more time, so the wavefront keeps a readable speed.
    const duration = Math.round(Math.min(680, Math.max(460, 260 + size * 0.24)));
    setSubmitPulse((current) => ({
      id: (current?.id ?? 0) + 1,
      x,
      y,
      size,
      start: Math.min(1, 28 / size),
      duration,
    }));
    if (!shouldReduceMotion) {
      void panelControls.start({
        scale: [1, 0.994, 1],
        transition: {
          duration: 0.42,
          times: [0, 0.18, 1],
          ease: [
            [0.3, 0, 0.6, 1],
            [0.2, 0.9, 0.3, 1],
          ],
        },
      });
    }
    setSendPressed(true);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => setSendPressed(false), 160);
  }

  function run(index: number, origin?: { clientX: number; clientY: number }) {
    if (finishedRef.current || !isPresent) return;
    if (index === askIndex) {
      if (!askMode) enterAskMode();
      if (!prompt || asking || askError || requestRef.current) return;
      pulse(origin);
      void askAI(prompt);
      return;
    }
    finishedRef.current = true;
    pulse(origin);
    requestRef.current?.abort();
    actionTimerRef.current = setTimeout(
      () => {
        if (index === 0) onCreate(query);
        else onOpenNote(results[index - 1].id);
      },
      shouldReduceMotion ? 0 : 80,
    );
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
    void scrollToBottom("instant");
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
    stopScroll();
    resizeAnimationsRef.current.forEach((animation) => animation.cancel());
    resizeOriginRef.current = null;
    scrollHoldRef.current = null;
    setHeldLatest(null);
    setExpanded(false);
    setAskMode(false);
    setActiveIndex(null);
    textareaRef.current?.focus();
  }

  function toggleExpanded() {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;
    const transcript = scrollRef.current;
    const content = contentRef.current;
    if (transcript && content && !scrollHoldRef.current) {
      scrollHoldRef.current = captureScroll(transcript, content, isAtBottom);
      setHeldLatest(!isAtBottom);
    }
    const { width, height } = panel.getBoundingClientRect();
    resizeOriginRef.current = {
      width,
      height,
      top: getComputedStyle(scrim).paddingTop,
    };
    setExpanded((current) => !current);
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
    } else if (
      showConversation &&
      event.key === "e" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.repeat &&
      (expanded || conversationOverflows) &&
      (!inInput || !query)
    ) {
      event.preventDefault();
      toggleExpanded();
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
        onClick={(event) => run(index, event)}
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
      ref={scrimRef}
      className="command-palette-scrim"
      data-expanded={expanded || undefined}
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
        animate={panelControls}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        {submitPulse ? (
          <span
            key={submitPulse.id}
            className="command-palette-submit-pulse"
            aria-hidden="true"
            style={
              {
                left: submitPulse.x,
                top: submitPulse.y,
                width: submitPulse.size,
                height: submitPulse.size,
                "--pulse-start": submitPulse.start,
                "--pulse-duration": `${submitPulse.duration}ms`,
              } as CSSProperties
            }
          />
        ) : null}
        <div className="command-palette-input-row">
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
          <button
            ref={keyRef}
            type="button"
            className="command-palette-key"
            aria-label={askMode ? "Send thought" : "Close"}
            aria-keyshortcuts={askMode ? "Enter" : "Escape"}
            title={askMode ? "Send thought" : "Close"}
            data-pressed={(askMode && sendPressed) || undefined}
            disabled={askMode && sendDisabled}
            onClick={(event) => {
              if (askMode) run(askIndex, event.detail ? event : undefined);
              else close();
            }}
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={askMode ? "send" : "close"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.12 }}
                aria-hidden="true"
              >
                {askMode ? "↵" : "Esc"}
              </motion.span>
            </AnimatePresence>
          </button>
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
                ref={scrollRef}
                id={`${id}-transcript`}
                className="command-palette-transcript"
                role="log"
                aria-label="Conversation"
                aria-live="off"
                aria-busy={asking}
                tabIndex={0}
              >
                <div
                  ref={contentRef}
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
                        <AssistantResponse
                          content={message.content}
                          streaming={message.id === draft?.id && asking}
                        />
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
                        onClick={(event) => {
                          if (requestRef.current) return;
                          pulse(event.detail ? event : undefined);
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
              {showLatest ? (
                <button
                  type="button"
                  className="command-palette-latest"
                  onClick={() => {
                    void scrollToBottom(
                      shouldReduceMotion ? "instant" : "smooth",
                    );
                    textareaRef.current?.focus({ preventScroll: true });
                  }}
                >
                  Latest ↓
                </button>
              ) : null}
            </div>
            {expanded || conversationOverflows ? (
              <div className="command-palette-footer">
                <motion.button
                  type="button"
                  className="command-palette-expand"
                  aria-label={
                    expanded ? "Collapse conversation" : "Expand conversation"
                  }
                  title={
                    expanded ? "Collapse conversation" : "Expand conversation"
                  }
                  aria-expanded={expanded}
                  aria-controls={`${id}-transcript`}
                  aria-keyshortcuts="e"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.14 }}
                  onClick={toggleExpanded}
                >
                  <kbd aria-hidden="true">e</kbd>
                  <span aria-hidden="true">
                    to {expanded ? "collapse" : "expand"}
                  </span>
                </motion.button>
              </div>
            ) : null}
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
