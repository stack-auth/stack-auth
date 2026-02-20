import { Button, Card } from "@/components/ui";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";

type EmailDraftUIProps = {
  setCurrentCode: (code: string) => void,
}

export const EmailDraftUI = ({ setCurrentCode }: EmailDraftUIProps) => {
  const ToolUI = makeAssistantToolUI<
    { content: string },
    "success"
  >({
    toolName: "createEmailDraft",
    render: ({ args }) => {
      return (
        <Card className="flex items-center gap-2 p-4 justify-between">
          <span className="text-sm">Created draft</span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentCode(args.content)}>
            <ArrowCounterClockwiseIcon className="size-4" />
          </Button>
        </Card>
      );
    },
  });

  return <ToolUI />;
};
