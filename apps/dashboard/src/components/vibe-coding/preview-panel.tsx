import { Typography } from "@stackframe/stack-ui";

type PreviewPanelProps = {
  children: React.ReactNode,
  title?: string,
}

export default function PreviewPanel({
  children,
  title = "Preview"
}: PreviewPanelProps) {
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
