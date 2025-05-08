export function InlineCode(props: { children: React.ReactNode }) {
  return <span className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 border border-gray-200 dark:border-gray-700 rounded-md font-mono text-sm">{props.children}</span>;
}
