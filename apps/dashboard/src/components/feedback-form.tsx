import { Button } from "@/components/ui";
import { SelectField } from "@/components/form-fields";
import { getPublicEnvVar } from "@/lib/env";
import { CheckCircleIcon, EnvelopeIcon, GithubLogoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { emailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { useState } from "react";
import { FaDiscord } from "react-icons/fa";
import * as yup from "yup";
import { SmartForm } from "./smart-form";

export function FeedbackForm() {
  const user = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const baseUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') || '';

  const domainFormSchema = yup.object({
    name: yup.string()
      .optional()
      .max(100)
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
      .max(5000)
      .label("Message")
      .meta({ type: "textarea" }),
    feedback_type: yup.string()
      .oneOf(["feedback", "bug"] as const)
      .defined()
      .label("Type")
      .default("feedback")
      .meta({
        stackFormFieldRender: (props: any) => (
          <SelectField
            {...props}
            options={[
              { value: "feedback", label: "Feedback" },
              { value: "bug", label: "Bug Report" },
            ]}
          />
        ),
      }),
  });

  const handleSubmit = async (values: yup.InferType<typeof domainFormSchema>) => {
    setSubmitStatus('idle');
    setErrorMessage('');

    try {
      // Auth headers are sent when available so the backend can include user
      // context in the email, but the endpoint accepts unauthenticated requests.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user) {
        const authJson = await user.getAuthJson();
        headers["X-Stack-Access-Type"] = "client";
        headers["X-Stack-Project-Id"] = "internal";
        headers["X-Stack-Publishable-Client-Key"] = getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY") ?? "";
        if (authJson.accessToken) {
          headers["X-Stack-Access-Token"] = authJson.accessToken;
        }
      }
      const response = await fetch(`${baseUrl}/api/v1/internal/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(responseText || `Failed to send feedback: ${response.status} ${response.statusText}`);
      }

      const result: { success?: boolean, message?: string } = await response.json();
      if (result.success !== true) {
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
          <CheckCircleIcon className="h-5 w-5 mx-auto mb-2 text-green-600" />
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
          <WarningCircleIcon className="h-5 w-5 mx-auto mb-2 text-red-600" />
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
            <EnvelopeIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
          <a
            href="https://github.com/stack-auth/stack-auth"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors group"
            title="View on GitHub"
          >
            <GithubLogoIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
        </div>
      </div>
    </div>
  );
}
