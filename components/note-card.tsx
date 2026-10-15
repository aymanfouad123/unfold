import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";

import type { Note } from "@/lib/notes";

type NoteCardProps = {
  note: Note;
  dragging: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, text: string) => void;
  onMeasure: (id: string, height: number) => void;
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
  dragging,
  selected,
  onSelect,
  onChange,
  onMeasure,
}: NoteCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editFinishedRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);

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
    if (dragging || editing) return;
    editFinishedRef.current = false;
    setDraft(note.text);
    setEditing(true);
  }

  function commitEdit() {
    if (editFinishedRef.current) return;
    editFinishedRef.current = true;
    setEditing(false);
    onChange(note.id, draft);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      editFinishedRef.current = true;
      setDraft(note.text);
      setEditing(false);
      cardRef.current?.focus();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commitEdit();
      if (draft.trim()) cardRef.current?.focus();
    }
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !editing) {
      event.preventDefault();
      event.stopPropagation();
      startEditing();
    }
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
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      role={editing ? undefined : "button"}
      tabIndex={editing ? -1 : 0}
      aria-label={`Note: ${note.text}`}
      aria-pressed={editing ? undefined : selected}
      onKeyDown={handleCardKeyDown}
      onFocus={() => onSelect(note.id)}
      onDoubleClick={startEditing}
    >
      {editing ? (
        <textarea
          className="nodrag nopan nowheel"
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
