"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";

import Composer from "@/components/composer";
import NoteCard from "@/components/note-card";
import {
  DEFAULT_VIEWPORT,
  type Note,
  type Viewport,
  clampZoom,
  findOpenPosition,
  readCanvasState,
  screenToWorld,
  writeCanvasState,
} from "@/lib/notes";

const NOTE_WIDTH = 240;
const DEFAULT_NOTE_HEIGHT = 50;
const GRID_SIZE = 24;

type Draft = {
  id: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  initialText: string;
};

type PanSession = {
  pointerId: number;
  startX: number;
  startY: number;
  viewportX: number;
  viewportY: number;
};

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, [contenteditable='true']") ||
      target.isContentEditable)
  );
}

export default function Canvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomPopoverRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanSession | null>(null);
  const spacePressedRef = useRef(false);
  const noteHeightsRef = useRef(new Map<string, number>());
  const composerHeightRef = useRef(DEFAULT_NOTE_HEIGHT);
  const resetAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = readCanvasState();
      setNotes(saved.notes);
      setViewport(saved.viewport);
      setLoaded(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timeout = window.setTimeout(() => {
      writeCanvasState({ notes, viewport });
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [loaded, notes, viewport]);

  useEffect(() => {
    return () => resetAnimationRef.current?.stop();
  }, []);

  const beginDraft = useCallback(
    (initialText = "") => {
      const root = rootRef.current;
      if (!root || draft) return;

      const rect = root.getBoundingClientRect();
      const screenPoint = { x: rect.width / 2, y: rect.height / 2 };
      const worldPoint = screenToWorld(screenPoint, viewport);
      const origin = {
        x: worldPoint.x - NOTE_WIDTH / 2,
        y: worldPoint.y - DEFAULT_NOTE_HEIGHT / 2,
      };

      composerHeightRef.current = DEFAULT_NOTE_HEIGHT;
      setSelectedId(null);
      setDraft({
        id: window.crypto.randomUUID(),
        ...origin,
        originX: origin.x,
        originY: origin.y,
        initialText,
      });
    },
    [draft, viewport],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(".zoom-controls")
      ) return;

      if (event.key === " " && !isTextInput(event.target)) {
        spacePressedRef.current = true;
        event.preventDefault();
        return;
      }

      if (isTextInput(event.target)) return;

      if (
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        beginDraft();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedId
      ) {
        event.preventDefault();
        setNotes((current) =>
          current.filter((note) => note.id !== selectedId),
        );
        setSelectedId(null);
        return;
      }

      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }

    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === " ") {
        spacePressedRef.current = false;
      }
    }

    function handleWindowBlur() {
      spacePressedRef.current = false;
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [beginDraft, selectedId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function handleWheel(event: WheelEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(".zoom-controls")
      ) return;
      event.preventDefault();
      resetAnimationRef.current?.stop();

      if (event.ctrlKey || event.metaKey) {
        setViewport((current) => {
          const nextZoom = clampZoom(
            current.zoom * Math.exp(-event.deltaY * 0.002),
          );
          const worldX = (event.clientX - current.x) / current.zoom;
          const worldY = (event.clientY - current.y) / current.zoom;

          return {
            x: event.clientX - worldX * nextZoom,
            y: event.clientY - worldY * nextZoom,
            zoom: nextZoom,
          };
        });
        return;
      }

      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
    }

    root.addEventListener("wheel", handleWheel, { passive: false });
    return () => root.removeEventListener("wheel", handleWheel);
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".zoom-controls")) return;
    const onNote = Boolean(target.closest(".note-card, .note-composer"));
    if (onNote && !spacePressedRef.current) return;

    setSelectedId(null);
    resetAnimationRef.current?.stop();
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewportX: viewport.x,
      viewportY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function handlePointerDownCapture(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (!spacePressedRef.current) return;
    handlePointerDown(event);
    event.stopPropagation();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    setViewport((current) => ({
      ...current,
      x: pan.viewportX + event.clientX - pan.startX,
      y: pan.viewportY + event.clientY - pan.startY,
    }));
  }

  function finishPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
  }

  function commitDraft(text: string) {
    if (!draft) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setDraft(null);
      return;
    }

    const now = new Date().toISOString();
    const z = notes.reduce((highest, note) => Math.max(highest, note.z), 0) + 1;
    const position = findOpenPosition(
      {
        x: draft.x,
        y: draft.y,
        width: NOTE_WIDTH,
        height: composerHeightRef.current,
      },
      notes.map((note) => ({
        x: note.x,
        y: note.y,
        width: NOTE_WIDTH,
        height: noteHeightsRef.current.get(note.id) ?? DEFAULT_NOTE_HEIGHT,
      })),
    );
    const note: Note = {
      id: draft.id,
      text: trimmed,
      ...position,
      z,
      createdAt: now,
      updatedAt: now,
    };

    setNotes((current) => [...current, note]);
    setDraft(null);
    setSelectedId(note.id);
  }

  function updateNotePosition(id: string, x: number, y: number) {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, x, y } : note)),
    );
  }

  function updateNoteText(id: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      setNotes((current) => current.filter((note) => note.id !== id));
      setSelectedId(null);
      return;
    }

    setNotes((current) =>
      current.map((note) =>
        note.id === id
          ? { ...note, text: trimmed, updatedAt: new Date().toISOString() }
          : note,
      ),
    );
  }

  function bringNoteToFront(id: string) {
    setSelectedId(id);
    setNotes((current) => {
      const highest = current.reduce(
        (value, note) => Math.max(value, note.z),
        0,
      );
      return current.map((note) =>
        note.id === id && note.z < highest
          ? { ...note, z: highest + 1 }
          : note,
      );
    });
  }

  const measureNote = useCallback((id: string, height: number) => {
    noteHeightsRef.current.set(id, height);
  }, []);

  const measureComposer = useCallback((height: number) => {
    composerHeightRef.current = height;
  }, []);

  function resetViewport() {
    zoomPopoverRef.current?.hidePopover();
    resetAnimationRef.current?.stop();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const worldCenter = screenToWorld(center, viewport);
    const target = {
      x: center.x - worldCenter.x,
      y: center.y - worldCenter.y,
      zoom: 1,
    };

    if (shouldReduceMotion) {
      setViewport(target);
      return;
    }

    const start = viewport;
    resetAnimationRef.current = animate(0, 1, {
      duration: 0.32,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (progress) => {
        setViewport({
          x: start.x + (target.x - start.x) * progress,
          y: start.y + (target.y - start.y) * progress,
          zoom:
            start.zoom + (target.zoom - start.zoom) * progress,
        });
      },
    });
  }

  const gridOpacity = Math.min(0.22, Math.max(0.07, viewport.zoom * 0.18));
  const gridStyle = {
    "--grid-size": `${GRID_SIZE * viewport.zoom}px`,
    "--grid-x": `${viewport.x}px`,
    "--grid-y": `${viewport.y}px`,
    "--grid-opacity": gridOpacity,
  } as CSSProperties;

  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: "spring", duration: 0.32, bounce: 0 }}
    >
      <main
        ref={rootRef}
        className={`canvas-shell${isPanning ? " is-panning" : ""}`}
        aria-label="Unfold notes canvas"
        aria-busy={!loaded}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
      >
        <div className="canvas-grid" style={gridStyle} aria-hidden="true" />
        <div
          className="canvas-world"
          style={{
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
          }}
        >
          <AnimatePresence>
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                zoom={viewport.zoom}
                selected={note.id === selectedId}
                onSelect={bringNoteToFront}
                onMove={updateNotePosition}
                onChange={updateNoteText}
                onMeasure={measureNote}
              />
            ))}
            {draft ? (
              <Composer
                key={draft.id}
                id={draft.id}
                x={draft.x}
                y={draft.y}
                originX={draft.originX}
                originY={draft.originY}
                initialText={draft.initialText}
                onCommit={commitDraft}
                onCancel={() => setDraft(null)}
                onMeasure={measureComposer}
              />
            ) : null}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {loaded && notes.length === 0 && !draft ? (
            <motion.div
              key="empty"
              className="canvas-empty"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4, transition: { duration: 0.14 } }}
            >
              <span>Unfold a thought</span>
              <kbd>⌘K</kbd>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="canvas-wordmark" aria-hidden="true">
          unfold
        </div>
        <div className="zoom-controls">
          <div
            ref={zoomPopoverRef}
            id="zoom-popover"
            className="zoom-popover"
            popover="auto"
            role="dialog"
            aria-label="Zoom options"
          >
            <button type="button" onClick={resetViewport}>
              <span>Reset zoom</span>
              <span className="zoom-popover-value">100%</span>
            </button>
          </div>
          <button
            className="zoom-reset"
            type="button"
            title="Zoom options"
            aria-label={`Zoom options, current zoom ${Math.round(viewport.zoom * 100)} percent`}
            aria-haspopup="dialog"
            popoverTarget="zoom-popover"
          >
            {Math.round(viewport.zoom * 100)}%
          </button>
        </div>
      </main>
    </MotionConfig>
  );
}
