import { makeAssistantToolUI } from "@assistant-ui/react";
import { Card } from "@stackframe/stack-ui";
import { CheckCircle, XCircle } from "lucide-react";

export const CreateEmailTemplateUI = makeAssistantToolUI<
  { content: any, subject: string },
  { success: boolean }
>({
  toolName: "createEmailTemplate",
  render: ({ result }) => {
    return (
      <Card className="flex items-center gap-2 p-4">
        {result?.success ? (
          <CheckCircle className="size-4 text-green-500" />
        ) : (
          <XCircle className="size-4 text-red-500" />
        )}
        <span className="text-sm">Updated email template</span>
      </Card>
    );
  },
});

export const UpdateEmailTemplateUI = makeAssistantToolUI<
  { content: any, subject: string },
  { success: boolean }
>({
  toolName: "updateEmailTemplate",
  render: ({ result }) => {
    return (
      <Card className="flex items-center gap-2 p-4">
        {result?.success ? (
          <CheckCircle className="size-4 text-green-500" />
        ) : (
          <XCircle className="size-4 text-red-500" />
        )}
        <span className="text-sm">Updated email template</span>
      </Card>
    );
  },
});
