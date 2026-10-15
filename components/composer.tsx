import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";

type ComposerProps = {
  id: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  initialText: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onMeasure: (height: number) => void;
};

export default function Composer({
  id,
  x,
  y,
  originX,
  originY,
  initialText,
  onCommit,
  onCancel,
  onMeasure,
}: ComposerProps) {
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const finishedRef = useRef(false);
  const [text, setText] = useState(initialText);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.max(21, textarea.scrollHeight)}px`;
  }, [text]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const reportHeight = () => onMeasure(composer.offsetHeight);
    reportHeight();

    const observer = new ResizeObserver(reportHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [onMeasure]);

  function commit() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(text);
  }

  function cancel() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit();
    }
  }

  return (
    <motion.div
      ref={composerRef}
      className="note-composer"
      style={{ left: x, top: y }}
      layoutId={`note-${id}`}
      initial={{
        opacity: 0,
        scale: 0.985,
        x: originX - x,
        y: originY - y + 4,
      }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={{
        opacity: 0,
        scale: 0.985,
        y: 4,
        transition: { duration: 0.12 },
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        aria-label="New note"
        placeholder="Unfold a thought…"
        rows={1}
        spellCheck
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
      <span className={`composer-submit${text.trim() ? " is-visible" : ""}`}>
        ↵
      </span>
    </motion.div>
  );
}
