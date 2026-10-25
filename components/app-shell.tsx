"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig } from "motion/react";

import CommandPalette from "@/components/command-palette";
import ViewToggle from "@/components/view-toggle";
import { notesActions, useNotesStore } from "@/lib/notes-store";

type AppShellProps = {
  children: ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { notes, loaded } = useNotesStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSession, setPaletteSession] = useState(0);

  const openPalette = useCallback(() => {
    if (!loaded) return;
    notesActions.selectNote(null);
    setPaletteSession((current) => current + 1);
    setPaletteOpen(true);
  }, [loaded]);

  const showCanvas = useCallback(() => {
    setPaletteOpen(false);
    router.push("/");
  }, [router]);

  const showGallery = useCallback(() => {
    setPaletteOpen(false);
    router.push("/gallery");
  }, [router]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.altKey) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!paletteOpen) openPalette();
        return;
      }
      if (!command || paletteOpen) return;
      if (event.key === "1") {
        event.preventDefault();
        showCanvas();
      } else if (event.key === "2") {
        event.preventDefault();
        showGallery();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openPalette, paletteOpen, showCanvas, showGallery]);

  function createNote(text: string) {
    const note = notesActions.createNote(text);
    setPaletteOpen(false);
    if (!note) return;
    if (pathname === "/gallery") return;
    router.push(`/?note=${encodeURIComponent(note.id)}`);
  }

  function openNote(id: string) {
    setPaletteOpen(false);
    if (pathname === "/gallery") {
      notesActions.selectNote(id);
      return;
    }
    router.push(`/?note=${encodeURIComponent(id)}`);
  }

  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: "spring", duration: 0.32, bounce: 0 }}
    >
      {children}

      <div className="app-chrome">
        <span className="canvas-wordmark" aria-hidden="true">
          unfold
        </span>
        <ViewToggle />
      </div>

      <AnimatePresence>
        {paletteOpen ? (
          <CommandPalette
            key={paletteSession}
            notes={notes}
            onCreate={createNote}
            onOpenNote={openNote}
            onShowCanvas={showCanvas}
            onShowGallery={showGallery}
            onClose={() => setPaletteOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
