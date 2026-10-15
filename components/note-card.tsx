import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";

import type { Note } from "@/lib/notes";

type NoteCardProps = {
  note: Note;
  zoom: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onChange: (id: string, text: string) => void;
  onMeasure: (id: string, height: number) => void;
};

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  moved: boolean;
};

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NoteCard({
  note,
  zoom,
  selected,
  onSelect,
  onMove,
  onChange,
  onMeasure,
}: NoteCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const cancelEditRef = useRef(false);
  const suppressDoubleClickRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const reportHeight = () => onMeasure(note.id, card.offsetHeight);
    reportHeight();

    const observer = new ResizeObserver(reportHeight);
    observer.observe(card);
    return () => observer.disconnect();
  }, [note.id, onMeasure]);

  useEffect(() => {
    if (!editing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editing]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !editing) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.max(21, textarea.scrollHeight)}px`;
  }, [draft, editing]);

  function startEditing() {
    if (dragging) return;
    cancelEditRef.current = false;
    setDraft(note.text);
    setEditing(true);
  }

  function commitEdit() {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    setEditing(false);
    onChange(note.id, draft);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEditRef.current = true;
      setDraft(note.text);
      setEditing(false);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commitEdit();
    }
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      startEditing();
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest("textarea")
    ) {
      return;
    }

    event.stopPropagation();
    onSelect(note.id);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      noteX: note.x,
      noteY: note.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(deltaX, deltaY) < 3) return;
    drag.moved = true;
    suppressDoubleClickRef.current = true;
    setDragging(true);
    onMove(note.id, drag.noteX + deltaX / zoom, drag.noteY + deltaY / zoom);
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    if (drag.moved) {
      window.setTimeout(() => {
        suppressDoubleClickRef.current = false;
      }, 0);
    }
  }

  function handleDoubleClick() {
    if (suppressDoubleClickRef.current) {
      suppressDoubleClickRef.current = false;
      return;
    }
    startEditing();
  }

  return (
    <motion.div
      ref={cardRef}
      className={[
        "note-card",
        selected ? "is-selected" : "",
        dragging ? "is-dragging" : "",
        editing ? "is-editing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left: note.x, top: note.y, zIndex: note.z }}
      layoutId={dragging ? undefined : `note-${note.id}`}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: dragging ? 1.015 : 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      role={editing ? undefined : "button"}
      tabIndex={editing ? -1 : 0}
      aria-label={`Note: ${note.text}`}
      aria-pressed={editing ? undefined : selected}
      onKeyDown={handleCardKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          aria-label="Edit note"
          rows={1}
          spellCheck
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={commitEdit}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <p>{note.text}</p>
      )}
      {!editing ? (
        <time
          dateTime={note.updatedAt}
          title={new Date(note.updatedAt).toString()}
        >
          {displayTime(note.updatedAt)}
        </time>
      ) : null}
    </motion.div>
  );
}
