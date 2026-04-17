import { useState, memo } from "react";
import { clsx } from "clsx";

function CopyBtn({ text, size = "xs" }: { text: string; size?: "xs" | "sm" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, (err) => {
          console.error("Clipboard write failed:", err);
        });
      }}
      className={clsx(
        "shrink-0 rounded transition-colors",
        size === "xs" ? "p-0.5" : "p-1",
        copied ? "text-green-500" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
      )}
      title={copied ? "Copied!" : "Copy"}
      type="button"
    >
      <span className={clsx("font-mono", size === "xs" ? "text-[10px]" : "text-xs")}>
        {copied ? "✓" : "⎘"}
      </span>
    </button>
  );
}

const InlineCode = memo(function InlineCode({ children }: { children?: React.ReactNode }) {
  const text = String(children || "");
  const isUrl = /^https?:\/\//.test(text);
  const isCommand = /^(npm|npx|pnpm|yarn|curl|git|docker|cd|mkdir|ls|brew|apt|pip)/.test(text);
  const isPath = /^[./~]/.test(text) && text.includes("/");
  const showCopy = isUrl || isCommand || isPath || text.length > 15;

  return (
    <code className="inline-flex items-center gap-1 max-w-full rounded px-1.5 py-0.5 bg-gray-100 text-[11px] font-mono leading-relaxed break-all">
      <span className={clsx("min-w-0", isUrl ? "text-blue-500" : "text-gray-800")}>
        {text}
      </span>
      {showCopy && <CopyBtn text={text} size="xs" />}
    </code>
  );
});

const CodeBlock = memo(function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const text = String(children || "").replace(/\n$/, "");
  const language = className?.replace("language-", "").toUpperCase() ?? "";

  return (
    <div className="relative group my-2.5 rounded-lg bg-gray-50 ring-1 ring-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-gray-100/50">
        <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wider">
          {language || "CODE"}
        </span>
        <CopyBtn text={text} size="xs" />
      </div>
      <div className="overflow-x-auto">
        <pre className="p-3 text-[11px] font-mono leading-relaxed">
          <code className="text-gray-800">{children}</code>
        </pre>
      </div>
    </div>
  );
});

const SmartLink = memo(function SmartLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-blue-500 hover:text-blue-600 hover:underline underline-offset-2 break-all"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? href ?? ""}
    </a>
  );
});

export const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] text-gray-800 mb-2.5 last:mb-0 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-[13px] text-gray-800 mb-2.5 pl-4 space-y-1 list-disc marker:text-gray-400">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="text-[13px] text-gray-800 mb-2.5 pl-4 space-y-1.5 list-decimal marker:text-gray-500">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed pl-0.5">{children}</li>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    if (className) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return <InlineCode>{children}</InlineCode>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-gray-600">{children}</em>
  ),
  a: SmartLink,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2.5 rounded-lg ring-1 ring-gray-200">
      <table className="w-full text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-gray-50 border-b border-gray-200">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-gray-100">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-2.5 py-1.5 text-left font-semibold text-gray-800 whitespace-nowrap">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-2.5 py-1.5 text-gray-600">{children}</td>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-semibold text-gray-900 mt-3 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-[14px] font-semibold text-gray-900 mt-3 mb-1.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[13px] font-semibold text-gray-900 mt-2.5 mb-1 first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-purple-400 pl-3 my-2 text-gray-500 italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
};
