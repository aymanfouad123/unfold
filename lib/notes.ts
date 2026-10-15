export type Note = {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  createdAt: string;
  updatedAt: string;
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasState = {
  notes: Note[];
  viewport: Viewport;
};

export const STORAGE_KEY = "unfold-canvas-v1";
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<Note>;

  return (
    typeof note.id === "string" &&
    typeof note.text === "string" &&
    isFiniteNumber(note.x) &&
    isFiniteNumber(note.y) &&
    isFiniteNumber(note.z) &&
    isValidDate(note.createdAt) &&
    isValidDate(note.updatedAt)
  );
}

function isViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== "object") return false;
  const viewport = value as Partial<Viewport>;

  return (
    isFiniteNumber(viewport.x) &&
    isFiniteNumber(viewport.y) &&
    isFiniteNumber(viewport.zoom) &&
    viewport.zoom >= MIN_ZOOM &&
    viewport.zoom <= MAX_ZOOM
  );
}

export function readCanvasState(): CanvasState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { notes: [], viewport: DEFAULT_VIEWPORT };
    }

    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object") {
      return { notes: [], viewport: DEFAULT_VIEWPORT };
    }

    const candidate = parsed as {
      notes?: unknown;
      viewport?: unknown;
    };

    return {
      notes: Array.isArray(candidate.notes)
        ? candidate.notes.filter(isNote)
        : [],
      viewport: isViewport(candidate.viewport)
        ? candidate.viewport
        : DEFAULT_VIEWPORT,
    };
  } catch {
    return { notes: [], viewport: DEFAULT_VIEWPORT };
  }
}

export function writeCanvasState(state: CanvasState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The canvas remains usable when storage is unavailable.
  }
}

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(
  point: { x: number; y: number },
  viewport: Viewport,
) {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function worldToScreen(
  point: { x: number; y: number },
  viewport: Viewport,
) {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}
