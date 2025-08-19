import { makeAssistantToolUI } from "@assistant-ui/react";
import { Button, Card } from "@stackframe/stack-ui";
import { Undo2 } from "lucide-react";

type EmailDraftUIProps = {
  setCurrentCode: (code: string) => void,
}

export const EmailDraftUI = ({ setCurrentCode }: EmailDraftUIProps) => {
  const ToolUI = makeAssistantToolUI<
    { content: string },
    "success"
  >({
    toolName: "createEmailTemplate",
    render: ({ args }) => {
      return (
        <Card className="flex items-center gap-2 p-4 justify-between">
          <span className="text-sm">Created draft</span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentCode(args.content)}>
            <Undo2 className="size-4" />
          </Button>
        </Card>
      );
    },
  });

  return <ToolUI />;
};
