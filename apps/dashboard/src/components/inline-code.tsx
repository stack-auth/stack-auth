import { cn } from "@/components/ui";

export function InlineCode(props: { children: React.ReactNode, className?: string }) {
  return (
    <span className={cn(
      "bg-gray-100 dark:bg-gray-800 px-1 py-0.5 border border-gray-200 dark:border-gray-700 rounded-md font-mono text-sm",
      props.className
    )}>
      {props.children}
    </span>
  );
}
