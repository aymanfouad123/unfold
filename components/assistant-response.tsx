import { Streamdown, type Components } from "streamdown";

// Keep structural blocks simple: the palette owns vertical scrolling.
const components: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  pre: ({ children }) => <pre dir="ltr" tabIndex={0} aria-label="Code block">{children}</pre>,
  code: ({ children, className }) => <code className={className}>{children}</code>,
  table: ({ children }) => (
    <div className="command-palette-table" tabIndex={0} role="region" aria-label="Table">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }) => <span>{alt}</span>,
};

export default function AssistantResponse({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <Streamdown className="command-palette-markdown" components={components}
      isAnimating={streaming} animated={false} controls={false} skipHtml dir="auto">
      {content}
    </Streamdown>
  );
}
