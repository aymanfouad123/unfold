import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type ComposerProps = {
  x: number;
  y: number;
  initialText: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
};

export default function Composer({
  x,
  y,
  initialText,
  onCommit,
  onCancel,
}: ComposerProps) {
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
    textarea.style.height = `${Math.max(64, textarea.scrollHeight)}px`;
  }, [text]);

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
    <div
      className="note-composer"
      style={{ left: x, top: y }}
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
    </div>
  );
}
