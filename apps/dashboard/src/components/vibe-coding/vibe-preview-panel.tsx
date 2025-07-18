import { Typography } from "@stackframe/stack-ui";

type VibePreviewPanelProps = {
  children: React.ReactNode,
  title?: string,
}

export default function VibePreviewPanel({
  children,
  title = "Preview"
}: VibePreviewPanelProps) {
  return (
    <>
      <div className="p-3 flex justify-between items-center">
        <Typography type="h4">{title}</Typography>
      </div>
      <div className="flex-1 p-6">
        {children}
      </div>
    </>
  );
}
