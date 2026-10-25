"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  DEFAULT_VIEWPORT,
  STORAGE_KEY,
  type CanvasState,
  type Note,
  type Viewport,
  findOpenPosition,
  readCanvasState,
  writeCanvasState,
} from "@/lib/notes";

const NOTE_WIDTH = 240;
const DEFAULT_NOTE_HEIGHT = 50;
const WRITE_DELAY = 100;

export type NotesSnapshot = CanvasState & {
  selectedId: string | null;
  loaded: boolean;
};

type CreateOptions = {
  width?: number;
  height?: number;
  noteHeights?: ReadonlyMap<string, number>;
};

const serverSnapshot: NotesSnapshot = {
  notes: [],
  viewport: DEFAULT_VIEWPORT,
  selectedId: null,
  loaded: false,
};

let snapshot = serverSnapshot;
let initialized = false;
let writeTimer: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function update(
  updater: (current: NotesSnapshot) => NotesSnapshot,
  persist = true,
) {
  const next = updater(snapshot);
  if (Object.is(next, snapshot)) return;
  snapshot = next;
  emit();

  if (!persist || !snapshot.loaded) return;
  if (writeTimer) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    writeCanvasState({
      notes: snapshot.notes,
      viewport: snapshot.viewport,
    });
  }, WRITE_DELAY);
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const saved = readCanvasState();
  snapshot = { ...saved, selectedId: null, loaded: true };
  window.addEventListener("storage", handleStorage);
  emit();
}

function handleStorage(event: StorageEvent) {
  if (event.key && event.key !== STORAGE_KEY) return;
  const saved = readCanvasState();
  update(
    (current) => ({
      ...current,
      ...saved,
      selectedId:
        current.selectedId &&
        saved.notes.some((note) => note.id === current.selectedId)
          ? current.selectedId
          : null,
    }),
    false,
  );
}

function measureNoteHeight(text: string) {
  if (typeof document === "undefined") return DEFAULT_NOTE_HEIGHT;
  const measurement = document.createElement("div");
  measurement.className = "note-card";
  measurement.style.visibility = "hidden";
  measurement.style.pointerEvents = "none";
  measurement.style.position = "absolute";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  measurement.append(paragraph);
  document.body.append(measurement);
  const height = measurement.offsetHeight || DEFAULT_NOTE_HEIGHT;
  measurement.remove();
  return height;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

export function useNotesStore() {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(initialize, []);
  return current;
}

export const notesActions = {
  createNote(text: string, options: CreateOptions = {}) {
    initialize();
    const trimmed = text.trim();
    if (!trimmed) return null;

    const width = options.width ?? window.innerWidth;
    const height = options.height ?? window.innerHeight;
    const { viewport, notes } = snapshot;
    const noteHeight = measureNoteHeight(trimmed);
    const center = {
      x: (width / 2 - viewport.x) / viewport.zoom,
      y: (height / 2 - viewport.y) / viewport.zoom,
    };
    const z =
      notes.reduce((highest, note) => Math.max(highest, note.z), 0) + 1;
    const position = findOpenPosition(
      {
        x: center.x - NOTE_WIDTH / 2,
        y: center.y - noteHeight / 2,
        width: NOTE_WIDTH,
        height: noteHeight,
      },
      notes.map((note) => ({
        x: note.x,
        y: note.y,
        width: NOTE_WIDTH,
        height: options.noteHeights?.get(note.id) ?? DEFAULT_NOTE_HEIGHT,
      })),
    );
    const now = new Date().toISOString();
    const note: Note = {
      id: window.crypto.randomUUID(),
      text: trimmed,
      ...position,
      z,
      createdAt: now,
      updatedAt: now,
    };
    update((current) => ({
      ...current,
      notes: [...current.notes, note],
      selectedId: note.id,
    }));
    return note;
  },

  updateNoteText(id: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      this.deleteNote(id);
      return;
    }
    update((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === id
          ? { ...note, text: trimmed, updatedAt: new Date().toISOString() }
          : note,
      ),
    }));
  },

  deleteNote(id: string) {
    update((current) => ({
      ...current,
      notes: current.notes.filter((note) => note.id !== id),
      selectedId: current.selectedId === id ? null : current.selectedId,
    }));
  },

  moveNotes(positions: ReadonlyMap<string, { x: number; y: number }>) {
    if (!positions.size) return;
    update((current) => ({
      ...current,
      notes: current.notes.map((note) => {
        const position = positions.get(note.id);
        return position ? { ...note, ...position } : note;
      }),
    }));
  },

  bringToFront(id: string) {
    update((current) => {
      const highest = current.notes.reduce(
        (value, note) => Math.max(value, note.z),
        0,
      );
      return {
        ...current,
        selectedId: id,
        notes: current.notes.map((note) =>
          note.id === id && note.z < highest
            ? { ...note, z: highest + 1 }
            : note,
        ),
      };
    });
  },

  selectNote(id: string | null) {
    update((current) => ({ ...current, selectedId: id }), false);
  },

  setViewport(viewport: Viewport) {
    update((current) => ({ ...current, viewport }));
  },
};
