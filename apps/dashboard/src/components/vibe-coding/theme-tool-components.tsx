import { makeAssistantToolUI } from "@assistant-ui/react";
import { Button, Card } from "@stackframe/stack-ui";
import { CheckCircle, Undo2 } from "lucide-react";

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
            <Undo2 className="size-4" />
          </Button>
        </Card>
      );
    },
  });

  return <ToolUI />;
};
