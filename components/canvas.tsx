"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
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

import {
  ReactFlow,
  ViewportPortal,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";

import Composer from "@/components/composer";
import NoteCard from "@/components/note-card";
import {
  DEFAULT_VIEWPORT,
  type Note,
  type Viewport,
  MIN_ZOOM,
  MAX_ZOOM,
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

type NoteNode = Node<
  {
    note: Note;
    onChange: (id: string, text: string) => void;
    onMeasure: (id: string, height: number) => void;
    onSelect: (id: string) => void;
  },
  "note"
>;

function CanvasNote({ data, selected, dragging }: NodeProps<NoteNode>) {
  return (
    <NoteCard
      note={data.note}
      selected={selected}
      dragging={dragging}
      onSelect={data.onSelect}
      onChange={data.onChange}
      onMeasure={data.onMeasure}
    />
  );
}

const nodeTypes = { note: CanvasNote };

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
  const [spacePressed, setSpacePressed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const noteHeightsRef = useRef(new Map<string, number>());
  const composerHeightRef = useRef(DEFAULT_NOTE_HEIGHT);
  const resetAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
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
      if (!root || draft || !loaded || draggingId) return;

      const rect = root.getBoundingClientRect();
      const screenPoint = { x: rect.width / 2, y: rect.height / 2 };
      const worldPoint = screenToWorld(screenPoint, viewport);
      const origin = {
        x: worldPoint.x - NOTE_WIDTH / 2,
        y: worldPoint.y - DEFAULT_NOTE_HEIGHT / 2,
      };

      composerHeightRef.current = DEFAULT_NOTE_HEIGHT;
      resetAnimationRef.current?.stop();
      setSpacePressed(false);
      setSelectedId(null);
      setDraft({
        id: window.crypto.randomUUID(),
        ...origin,
        originX: origin.x,
        originY: origin.y,
        initialText,
      });
    },
    [draft, viewport, loaded, draggingId],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(".zoom-controls")
      ) return;

      if (event.key === " " && !isTextInput(event.target)) {
        setSpacePressed(true);
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
        setSpacePressed(false);
      }
    }

    function handleWindowBlur() {
      setSpacePressed(false);
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

  const handleNodesChange = useCallback((changes: NodeChange<NoteNode>[]) => {
    for (const change of changes) {
      if (change.type === "select") {
        setSelectedId((current) =>
          change.selected ? change.id : current === change.id ? null : current,
        );
      }
    }
    const positions = new Map(
      changes.flatMap((change) =>
        change.type === "position" && change.position
          ? [[change.id, change.position] as const]
          : [],
      ),
    );
    if (positions.size) {
      setNotes((current) =>
        current.map((note) => {
          const position = positions.get(note.id);
          return position ? { ...note, ...position } : note;
        }),
      );
    }
  }, []);

  const updateNoteText = useCallback((id: string, text: string) => {
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
  }, []);

  const bringNoteToFront = useCallback((id: string) => {
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
  }, []);

  const measureNote = useCallback((id: string, height: number) => {
    noteHeightsRef.current.set(id, height);
  }, []);

  const measureComposer = useCallback((height: number) => {
    composerHeightRef.current = height;
  }, []);

  const nodes = useMemo<NoteNode[]>(
    () => notes.map((note) => ({
      id: note.id,
      type: "note",
      position: { x: note.x, y: note.y },
      selected: note.id === selectedId,
      zIndex: note.z,
      data: {
        note,
        onChange: updateNoteText,
        onMeasure: measureNote,
        onSelect: bringNoteToFront,
      },
    })),
    [notes, selectedId, updateNoteText, measureNote, bringNoteToFront],
  );

  const handlePaneClick = useCallback(() => setSelectedId(null), []);
  const handleNodeClick = useCallback((_event: unknown, node: NoteNode) => {
    bringNoteToFront(node.id);
  }, [bringNoteToFront]);
  const handleDragStart = useCallback((_event: unknown, node: NoteNode) => {
    resetAnimationRef.current?.stop();
    setDraggingId(node.id);
    bringNoteToFront(node.id);
  }, [bringNoteToFront]);
  const handleDragStop = useCallback(() => setDraggingId(null), []);
  const handleMoveStart = useCallback((event: unknown) => {
    // Controlled viewport updates also emit callbacks with a sync marker.
    // Only a native gesture should interrupt the reset animation.
    if (event instanceof Event) {
      resetAnimationRef.current?.stop();
    }
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
        className="canvas-shell"
        aria-label="Unfold notes canvas"
        aria-busy={!loaded}
      >
        <div className="canvas-grid" style={gridStyle} aria-hidden="true" />
        <ReactFlow<NoteNode>
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          viewport={viewport}
          onViewportChange={setViewport}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          panOnDrag={[0, 1]}
          panOnScroll={!draggingId}
          panOnScrollSpeed={1}
          panActivationKeyCode="Space"
          zoomActivationKeyCode={draggingId ? null : ["Control", "Meta"]}
          zoomOnScroll={false}
          // Trackpad pinch and Ctrl+wheel share the browser ctrlKey signal.
          zoomOnPinch={!draggingId}
          zoomOnDoubleClick={false}
          nodesDraggable={!spacePressed || !!draggingId}
          nodesConnectable={false}
          nodesFocusable={false}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          deleteKeyCode={null}
          nodeDragThreshold={3}
          nodeClickDistance={3}
          paneClickDistance={3}
          autoPanOnNodeDrag={false}
          elevateNodesOnSelect={false}
          onPaneClick={handlePaneClick}
          onNodeClick={handleNodeClick}
          onNodeDragStart={handleDragStart}
          onNodeDragStop={handleDragStop}
          onMoveStart={handleMoveStart}
          attributionPosition="top-right"
        >
          <ViewportPortal>
            <AnimatePresence>
              {draft ? (
                <Composer
                  key={draft.id}
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
          </ViewportPortal>
        </ReactFlow>

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
