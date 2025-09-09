import { useUser } from "@stackframe/stack";
import { emailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Button } from "@stackframe/stack-ui";
import { AlertCircle, CheckCircle2, Github, Mail } from "lucide-react";
import { useState } from "react";
import { FaDiscord } from "react-icons/fa";
import * as yup from "yup";
import { SmartForm } from "./smart-form";

export function FeedbackForm() {
  const user = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

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
    setSubmitStatus('idle');
    setErrorMessage('');

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
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

      if (!response.ok) {
        throw new Error(`Failed to send feedback: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to send feedback');
      }

      setSubmitStatus('success');
    } catch (error) {
      captureError("feedback-form-submit", error);
      setSubmitStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-sm font-semibold mb-2">Send us feedback</h3>
        <p className="text-xs text-muted-foreground">
          We&apos;d love to hear your thoughts and suggestions
        </p>
      </div>

      {/* Success State */}
      {submitStatus === 'success' && (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center border border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-green-600" />
          <p className="text-sm text-green-800 dark:text-green-200 font-medium">
            Feedback sent successfully!
          </p>
          <p className="text-xs text-green-600 dark:text-green-300 mt-1">
            We&apos;ll get back to you soon.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubmitStatus('idle')}
            className="mt-3"
          >
            Send Another
          </Button>
        </div>
      )}

      {/* Error State */}
      {submitStatus === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center border border-red-200 dark:border-red-800">
          <AlertCircle className="h-5 w-5 mx-auto mb-2 text-red-600" />
          <p className="text-sm text-red-800 dark:text-red-200 font-medium">
            Failed to send feedback
          </p>
          <p className="text-xs text-red-600 dark:text-red-300 mt-1">
            {errorMessage || 'Please try again or contact us directly.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubmitStatus('idle')}
            className="mt-3"
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Form - only show if not in success state */}
      {submitStatus !== 'success' && (
        <>
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
        </>
      )}

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
