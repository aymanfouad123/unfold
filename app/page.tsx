import { Suspense } from "react";

import Canvas from "@/components/canvas";

export default function Home() {
  return (
    <Suspense fallback={<main className="canvas-shell" aria-busy="true" />}>
      <Canvas />
    </Suspense>
  );
}
