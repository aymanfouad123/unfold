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
import { useSearchParams } from "next/navigation";

import {
  ReactFlow,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import NoteCard from "@/components/note-card";
import {
  type Note,
  type Viewport,
  MIN_ZOOM,
  MAX_ZOOM,
  screenToWorld,
} from "@/lib/notes";
import { notesActions, useNotesStore } from "@/lib/notes-store";

const NOTE_WIDTH = 240;
const DEFAULT_NOTE_HEIGHT = 50;
const GRID_SIZE = 24;

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
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomPopoverRef = useRef<HTMLDivElement>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const noteHeightsRef = useRef(new Map<string, number>());
  const handledNoteRef = useRef<string | null>(null);
  const viewportAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const { notes, viewport, selectedId, loaded } = useNotesStore();
  const [nodeMeasurements, setNodeMeasurements] = useState<
    Record<string, NonNullable<NoteNode["measured"]>>
  >({});
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    return () => viewportAnimationRef.current?.stop();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;

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
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedId
      ) {
        event.preventDefault();
        notesActions.deleteNote(selectedId);
        return;
      }

      if (event.key === "Escape") {
        notesActions.selectNote(null);
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
  }, [selectedId]);

  const handleNodesChange = useCallback((changes: NodeChange<NoteNode>[]) => {
    const dimensions = changes.filter(
      (change) => change.type === "dimensions" && change.dimensions,
    );
    if (dimensions.length) {
      setNodeMeasurements((current) => {
        let next = current;
        for (const change of dimensions) {
          if (change.type !== "dimensions" || !change.dimensions) continue;
          const measured = current[change.id];
          if (
            measured?.width === change.dimensions.width &&
            measured?.height === change.dimensions.height
          ) continue;
          if (next === current) next = { ...current };
          next[change.id] = change.dimensions;
        }
        return next;
      });
    }
    for (const change of changes) {
      if (change.type === "select") {
        if (change.selected) notesActions.selectNote(change.id);
        else if (selectedId === change.id) notesActions.selectNote(null);
      }
    }
    const positions = new Map(
      changes.flatMap((change) =>
        change.type === "position" && change.position
          ? [[change.id, change.position] as const]
          : [],
      ),
    );
    notesActions.moveNotes(positions);
  }, [selectedId]);

  const updateNoteText = useCallback((id: string, text: string) => {
    notesActions.updateNoteText(id, text);
  }, []);

  const bringNoteToFront = useCallback((id: string) => {
    notesActions.bringToFront(id);
  }, []);

  const measureNote = useCallback((id: string, height: number) => {
    noteHeightsRef.current.set(id, height);
  }, []);

  const nodes = useMemo<NoteNode[]>(
    () => notes.map((note) => ({
      id: note.id,
      type: "note",
      position: { x: note.x, y: note.y },
      // Controlled updates must retain dimensions so React Flow keeps nodes visible.
      measured: nodeMeasurements[note.id],
      selected: note.id === selectedId,
      zIndex: note.z,
      data: {
        note,
        onChange: updateNoteText,
        onMeasure: measureNote,
        onSelect: bringNoteToFront,
      },
    })),
    [notes, nodeMeasurements, selectedId, updateNoteText, measureNote, bringNoteToFront],
  );

  const handlePaneClick = useCallback(() => notesActions.selectNote(null), []);
  const handleNodeClick = useCallback((_event: unknown, node: NoteNode) => {
    bringNoteToFront(node.id);
  }, [bringNoteToFront]);
  const handleDragStart = useCallback((_event: unknown, node: NoteNode) => {
    viewportAnimationRef.current?.stop();
    setDraggingId(node.id);
    bringNoteToFront(node.id);
  }, [bringNoteToFront]);
  const handleDragStop = useCallback(() => setDraggingId(null), []);
  const handleMoveStart = useCallback((event: unknown) => {
    // Controlled viewport updates also emit callbacks with a sync marker.
    // Only a native gesture should interrupt the viewport animation.
    if (event instanceof Event) {
      viewportAnimationRef.current?.stop();
    }
  }, []);

  function resetViewport() {
    zoomPopoverRef.current?.hidePopover();
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

    animateViewportTo(target);
  }

  function animateViewportTo(target: Viewport) {
    viewportAnimationRef.current?.stop();
    if (shouldReduceMotion) {
      notesActions.setViewport(target);
      return;
    }

    const start = viewport;
    viewportAnimationRef.current = animate(0, 1, {
      duration: 0.32,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (progress) => {
        notesActions.setViewport({
          x: start.x + (target.x - start.x) * progress,
          y: start.y + (target.y - start.y) * progress,
          zoom:
            start.zoom + (target.zoom - start.zoom) * progress,
        });
      },
    });
  }

  function openNote(id: string) {
    const note = notes.find((note) => note.id === id);
    const root = rootRef.current;
    if (!note || !root) return;
    bringNoteToFront(id);
    const rect = root.getBoundingClientRect();
    const height = noteHeightsRef.current.get(id) ?? DEFAULT_NOTE_HEIGHT;
    animateViewportTo({
      x: rect.width / 2 - (note.x + NOTE_WIDTH / 2) * viewport.zoom,
      y: rect.height / 2 - (note.y + height / 2) * viewport.zoom,
      zoom: viewport.zoom,
    });
  }

  useEffect(() => {
    const noteId = searchParams.get("note");
    if (!noteId) {
      handledNoteRef.current = null;
      return;
    }
    if (!loaded || !rootRef.current) return;
    if (!notes.some((note) => note.id === noteId)) return;
    if (handledNoteRef.current === noteId) return;
    handledNoteRef.current = noteId;
    openNote(noteId);
    window.history.replaceState(null, "", "/");
    // openNote intentionally reads the latest viewport only when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, notes, searchParams]);

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
        tabIndex={-1}
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
          onViewportChange={notesActions.setViewport}
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
        />

        <AnimatePresence>
          {loaded && notes.length === 0 ? (
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
