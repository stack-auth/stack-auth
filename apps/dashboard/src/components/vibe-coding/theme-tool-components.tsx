import { Button, Card } from "@/components/ui";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";

type EmailThemeUIProps = {
  setCurrentCode: (code: string) => void,
}

export const EmailThemeUI = ({ setCurrentCode }: EmailThemeUIProps) => {
  const ToolUI = makeAssistantToolUI<
    { content: string },
    "success"
  >({
    toolName: "createEmailTheme",
    render: ({ args }) => {
      return (
        <Card className="flex items-center gap-2 p-4 justify-between">
          <span className="text-sm">Created theme</span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentCode(args.content)}>
            <ArrowCounterClockwiseIcon className="size-4" />
          </Button>
        </Card>
      );
    },
  });

  return <ToolUI />;
};
