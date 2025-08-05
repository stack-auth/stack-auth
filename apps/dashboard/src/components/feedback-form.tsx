import { useUser } from "@stackframe/stack";
import { emailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { Button, useToast } from "@stackframe/stack-ui";
import { Github, Mail } from "lucide-react";
import { useState } from "react";
import { FaDiscord } from "react-icons/fa";
import * as yup from "yup";
import { SmartForm } from "./smart-form";

export function FeedbackForm() {
  const user = useUser();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const domainFormSchema = yup.object({
    name: yup.string()
      .optional()
      .label("Your name")
      .default(user?.displayName),
    email: emailSchema
      .defined()
      .nonEmpty("Email is required")
      .label("Your email")
      .default(user?.primaryEmail),
    message: yup.string()
      .defined()
      .nonEmpty("Message is required")
      .label("Message")
      .meta({ type: "textarea" }),
  });

  const handleSubmit = async (values: yup.InferType<typeof domainFormSchema>) => {
    await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...values,
        type: "feedback",
        // This is the public access key, so no worries
        access_key: '4f0fc468-c066-4e45-95c1-546fd652a44a',
      }, null, 2),
    });
    toast({
      title: "Feedback sent",
      description: "We'll get back to you soon",
      variant: "success"
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-sm font-semibold mb-2">Send us feedback</h3>
        <p className="text-xs text-muted-foreground">
          We&apos;d love to hear your thoughts and suggestions
        </p>
      </div>
      <SmartForm
        formSchema={domainFormSchema}
        onSubmit={handleSubmit}
        onChangeIsSubmitting={setSubmitting}
        formId="feedback-form"
      />
      <Button
        type="submit"
        form="feedback-form"
        className="w-full"
        loading={submitting}
        disabled={submitting}
      >
        Send Feedback
      </Button>

      {/* Additional Support Links */}
      <div className="pt-4 border-t border-border/50">
        <p className="text-xs text-muted-foreground text-center mb-3">
          Other ways to reach us
        </p>
        <div className="flex justify-center gap-4">
          <a
            href="https://discord.stack-auth.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors group"
            title="Join our Discord"
          >
            <FaDiscord className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
          <a
            href="mailto:team@stack-auth.com"
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors group"
            title="Email us"
          >
            <Mail className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
          <a
            href="https://github.com/stack-auth/stack-auth"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors group"
            title="View on GitHub"
          >
            <Github className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
        </div>
      </div>
    </div>
  );
}
