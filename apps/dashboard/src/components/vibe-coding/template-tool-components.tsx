import { makeAssistantToolUI } from "@assistant-ui/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { Button, Card } from "@stackframe/stack-ui";

type EmailTemplateUIProps = {
  setCurrentCode: (code: string) => void,
}

export const EmailTemplateUI = ({ setCurrentCode }: EmailTemplateUIProps) => {
  const ToolUI = makeAssistantToolUI<
    { content: string },
    "success"
  >({
    toolName: "createEmailTemplate",
    render: ({ args }) => {
      return (
        <Card className="flex items-center gap-2 p-4 justify-between">
          <span className="text-sm">Created template</span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentCode(args.content)}>
            <ArrowCounterClockwiseIcon className="size-4" />
          </Button>
        </Card>
      );
    },
  });

  return <ToolUI />;
};
