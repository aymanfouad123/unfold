"use client";

import {
  ViewTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useRouter } from "next/navigation";

import type { Note } from "@/lib/notes";
import { notesActions, useNotesStore } from "@/lib/notes-store";

type NoteGroup = {
  label: string;
  notes: Note[];
};

const monthName = new Intl.DateTimeFormat("en", { month: "long" });
const MAX_MORPHS = 24;

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, [contenteditable='true']") ||
      target.isContentEditable ||
      target.closest(".command-palette"))
  );
}

function formatCardDate(value: string) {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupNotes(notes: Note[]): NoteGroup[] {
  const now = new Date();
  const today = startOfDay(now);
  const weekAgo = today - 7 * 86_400_000;
  const groups = new Map<string, Note[]>();

  for (const note of [...notes].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )) {
    const date = new Date(note.updatedAt);
    const time = date.getTime();
    let label: string;
    if (time >= today) label = "Today";
    else if (time >= weekAgo) label = "Previous 7 days";
    else {
      label =
        date.getFullYear() === now.getFullYear()
          ? monthName.format(date)
          : String(date.getFullYear());
    }
    const group = groups.get(label);
    if (group) group.push(note);
    else groups.set(label, [note]);
  }

  return [...groups].map(([label, groupedNotes]) => ({
    label,
    notes: groupedNotes,
  }));
}

function noteParts(text: string) {
  const lines = text.split(/\r?\n/);
  const title = lines.find((line) => line.trim())?.trim() || "Untitled";
  const titleIndex = lines.findIndex((line) => line.trim());
  const preview = lines.slice(titleIndex + 1).join("\n").trim();
  return { title, preview };
}

export default function Gallery() {
  const router = useRouter();
  const { notes, selectedId, loaded } = useNotesStore();
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const groups = useMemo(() => groupNotes(notes), [notes]);
  const orderedNotes = useMemo(
    () => groups.flatMap((group) => group.notes),
    [groups],
  );

  const openNote = useCallback((id: string) => {
    router.push(`/?note=${encodeURIComponent(id)}`);
  }, [router]);

  const moveSelection = useCallback((key: string) => {
    if (!orderedNotes.length) return;
    const currentId = selectedId ?? orderedNotes[0].id;
    const current = cardRefs.current.get(currentId);
    if (!current) {
      notesActions.selectNote(orderedNotes[0].id);
      cardRefs.current.get(orderedNotes[0].id)?.focus();
      return;
    }

    const origin = current.getBoundingClientRect();
    const originX = origin.left + origin.width / 2;
    const originY = origin.top + origin.height / 2;
    let closest: { id: string; score: number } | null = null;

    for (const note of orderedNotes) {
      if (note.id === currentId) continue;
      const candidate = cardRefs.current.get(note.id)?.getBoundingClientRect();
      if (!candidate) continue;
      const x = candidate.left + candidate.width / 2;
      const y = candidate.top + candidate.height / 2;
      const dx = x - originX;
      const dy = y - originY;
      const valid =
        (key === "ArrowLeft" && dx < -1) ||
        (key === "ArrowRight" && dx > 1) ||
        (key === "ArrowUp" && dy < -1) ||
        (key === "ArrowDown" && dy > 1);
      if (!valid) continue;
      const primary =
        key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dx) : Math.abs(dy);
      const secondary =
        key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2;
      if (!closest || score < closest.score) closest = { id: note.id, score };
    }

    if (closest) {
      notesActions.selectNote(closest.id);
      cardRefs.current.get(closest.id)?.focus();
    }
  }, [orderedNotes, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const card = cardRefs.current.get(selectedId);
    if (!card) return;
    const frame = window.requestAnimationFrame(() => {
      card.scrollIntoView({ block: "nearest" });
      card.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, orderedNotes]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing || isTextInput(event.target)) return;
      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        moveSelection(event.key);
      } else if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedId
      ) {
        event.preventDefault();
        const index = orderedNotes.findIndex((note) => note.id === selectedId);
        const next =
          orderedNotes[index + 1]?.id ?? orderedNotes[index - 1]?.id ?? null;
        notesActions.deleteNote(selectedId);
        if (next) {
          notesActions.selectNote(next);
          requestAnimationFrame(() => cardRefs.current.get(next)?.focus());
        }
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        openNote(selectedId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveSelection, openNote, orderedNotes, selectedId]);

  return (
    <main
      className="gallery-shell"
      aria-label="All notes"
      aria-busy={!loaded}
    >
      <header className="gallery-header">
        <h1>Notes</h1>
        <p>{notes.length} {notes.length === 1 ? "note" : "notes"}</p>
      </header>

      {loaded && notes.length === 0 ? (
        <div className="gallery-empty">
          <span>No notes yet</span>
          <span>Press ⌘K to unfold a thought</span>
        </div>
      ) : (
        <div className="gallery-groups">
          {groups.map((group, groupIndex) => {
            const offset = groups
              .slice(0, groupIndex)
              .reduce((count, current) => count + current.notes.length, 0);
            return (
            <section className="gallery-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="gallery-grid">
                {group.notes.map((note, index) => {
                  const { title, preview } = noteParts(note.text);
                  const morph = offset + index < MAX_MORPHS;
                  return (
                    <button
                      key={note.id}
                      ref={(element) => {
                        if (element) cardRefs.current.set(note.id, element);
                        else cardRefs.current.delete(note.id);
                      }}
                      type="button"
                      className={`gallery-card${selectedId === note.id ? " is-selected" : ""}`}
                      aria-label={`Open note: ${title}`}
                      aria-pressed={selectedId === note.id}
                      onClick={() => notesActions.selectNote(note.id)}
                      onDoubleClick={() => openNote(note.id)}
                    >
                      {morph ? (
                        <ViewTransition
                          name={`note-${note.id}`}
                          share="note-morph"
                          default="none"
                        >
                          <span className="gallery-card-preview">
                            <strong>{title}</strong>
                            {preview ? <span>{preview}</span> : null}
                          </span>
                        </ViewTransition>
                      ) : (
                        <span className="gallery-card-preview">
                          <strong>{title}</strong>
                          {preview ? <span>{preview}</span> : null}
                        </span>
                      )}
                      <span className="gallery-card-meta">
                        <strong>{title}</strong>
                        <time dateTime={note.updatedAt}>
                          {formatCardDate(note.updatedAt)}
                        </time>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
