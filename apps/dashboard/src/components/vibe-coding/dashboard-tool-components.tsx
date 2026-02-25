import { Button, Card } from "@/components/ui";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";

type DashboardToolUIProps = {
  setCurrentCode: (code: string) => void,
}

export const DashboardToolUI = ({ setCurrentCode }: DashboardToolUIProps) => {
  const ToolUI = makeAssistantToolUI<
    { content: string },
    "success"
  >({
    toolName: "updateDashboard",
    render: ({ args }) => {
      return (
        <Card className="flex items-center gap-2 p-4 justify-between">
          <span className="text-sm">Updated dashboard</span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentCode(args.content)}>
            <ArrowCounterClockwiseIcon className="size-4" />
          </Button>
        </Card>
      );
    },
  });

  return <ToolUI />;
};
