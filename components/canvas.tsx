"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import Composer from "@/components/composer";
import NoteCard from "@/components/note-card";
import {
  DEFAULT_VIEWPORT,
  type Note,
  type Viewport,
  clampZoom,
  readCanvasState,
  screenToWorld,
  writeCanvasState,
} from "@/lib/notes";

const NOTE_WIDTH = 240;
const GRID_SIZE = 24;

type Draft = {
  id: number;
  x: number;
  y: number;
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
  const pointerRef = useRef({ x: 0, y: 0, seen: false });
  const panRef = useRef<PanSession | null>(null);
  const spacePressedRef = useRef(false);
  const draftCounterRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

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
    return () => {
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  const beginDraft = useCallback(
    (initialText = "") => {
      const root = rootRef.current;
      if (!root || draft) return;

      const rect = root.getBoundingClientRect();
      const hasPointer = pointerRef.current.seen;
      const screenPoint = hasPointer
        ? { x: pointerRef.current.x, y: pointerRef.current.y }
        : { x: rect.width / 2, y: rect.height / 2 };
      const worldPoint = screenToWorld(screenPoint, viewport);

      draftCounterRef.current += 1;
      setSelectedId(null);
      setDraft({
        id: draftCounterRef.current,
        x: worldPoint.x - (hasPointer ? 20 : NOTE_WIDTH / 2),
        y: worldPoint.y - (hasPointer ? 18 : 56),
        initialText,
      });
    },
    [draft, viewport],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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

      if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        beginDraft(event.key);
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
      event.preventDefault();

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
    const onNote = Boolean(target.closest(".note-card, .note-composer"));
    if (onNote && !spacePressedRef.current) return;

    setSelectedId(null);
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
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      seen: true,
    };

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
    const id = window.crypto.randomUUID();
    const z = notes.reduce((highest, note) => Math.max(highest, note.z), 0) + 1;
    const note: Note = {
      id,
      text: trimmed,
      x: draft.x,
      y: draft.y,
      z,
      createdAt: now,
      updatedAt: now,
    };

    setNotes((current) => [...current, note]);
    setDraft(null);
    setSelectedId(id);
    setSettlingId(id);
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      setSettlingId(null);
    }, 240);
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

  const gridOpacity = Math.min(0.22, Math.max(0.07, viewport.zoom * 0.18));
  const gridStyle = {
    "--grid-size": `${GRID_SIZE * viewport.zoom}px`,
    "--grid-x": `${viewport.x}px`,
    "--grid-y": `${viewport.y}px`,
    "--grid-opacity": gridOpacity,
  } as CSSProperties;

  return (
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
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            zoom={viewport.zoom}
            selected={note.id === selectedId}
            settling={note.id === settlingId}
            onSelect={bringNoteToFront}
            onMove={updateNotePosition}
            onChange={updateNoteText}
          />
        ))}
        {draft ? (
          <Composer
            key={draft.id}
            x={draft.x}
            y={draft.y}
            initialText={draft.initialText}
            onCommit={commitDraft}
            onCancel={() => setDraft(null)}
          />
        ) : null}
      </div>

      <div
        className={`canvas-empty${loaded && notes.length === 0 && !draft ? " is-visible" : ""}`}
        aria-hidden={notes.length > 0 || Boolean(draft)}
      >
        <span>Start typing to unfold a thought</span>
        <kbd>⌘K</kbd>
      </div>

      <div className="canvas-wordmark" aria-hidden="true">
        unfold
      </div>
      <button
        className="zoom-reset"
        type="button"
        title="Reset view"
        aria-label={`Reset view, current zoom ${Math.round(viewport.zoom * 100)} percent`}
        onClick={() => setViewport(DEFAULT_VIEWPORT)}
      >
        {Math.round(viewport.zoom * 100)}%
      </button>
    </main>
  );
}
