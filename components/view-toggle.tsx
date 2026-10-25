"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function ViewToggle() {
  const pathname = usePathname();
  const galleryActive = pathname === "/gallery";
  const [tipOpen, setTipOpen] = useState(false);
  const pointerInside = useRef(false);
  const suppressUntilLeave = useRef(false);

  useEffect(() => {
    setTipOpen(false);
    if (pointerInside.current) suppressUntilLeave.current = true;
  }, [pathname]);

  return (
    <nav
      className={`view-toggle${tipOpen ? " is-tip-open" : ""}`}
      aria-label="Note view"
      aria-describedby="view-toggle-tip"
      onPointerEnter={() => {
        pointerInside.current = true;
        if (!suppressUntilLeave.current) setTipOpen(true);
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        suppressUntilLeave.current = false;
        setTipOpen(false);
      }}
      onPointerDown={() => {
        setTipOpen(false);
        if (pointerInside.current) suppressUntilLeave.current = true;
      }}
    >
      <Link
        href="/"
        prefetch
        transitionTypes={["to-canvas"]}
        className={!galleryActive ? "is-active" : undefined}
        aria-current={!galleryActive ? "page" : undefined}
        aria-keyshortcuts="Meta+1 Control+1"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="5" height="4" rx="1" />
          <rect x="9" y="9" width="5" height="4" rx="1" />
        </svg>
        <span className="sr-only">Canvas</span>
      </Link>
      <Link
        href="/gallery"
        prefetch
        transitionTypes={["to-gallery"]}
        className={galleryActive ? "is-active" : undefined}
        aria-current={galleryActive ? "page" : undefined}
        aria-keyshortcuts="Meta+2 Control+2"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
        <span className="sr-only">Gallery</span>
      </Link>
      <div id="view-toggle-tip" role="tooltip" className="view-toggle-tip">
        <div className="view-toggle-tip-row">
          <span>Canvas</span>
          <kbd>⌘1</kbd>
        </div>
        <div className="view-toggle-tip-row">
          <span>Gallery</span>
          <kbd>⌘2</kbd>
        </div>
      </div>
    </nav>
  );
}
