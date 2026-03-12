import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerUser } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { countryCodeSchema, emailSchema, jsonStringOrEmptySchema, passwordSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Typography, useToast } from "@/components/ui";
import * as yup from "yup";
import { FormDialog } from "./form-dialog";
import { CountryCodeField } from "./country-code-select";
import { DateField, InputField, SwitchField, TextAreaField } from "./form-fields";
import { StyledLink } from "./link";
import { validateRiskScore } from "@/lib/risk-score-utils";

const metadataDocsUrl = "https://docs.stack-auth.com/docs/concepts/custom-user-data";

export function UserDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
} & ({
  type: 'create',
} | {
  type: 'edit',
  user: ServerUser,
})) {
  const { toast } = useToast();
  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  let defaultValues;
  if (props.type === 'edit') {
    defaultValues = {
      displayName: props.user.displayName || undefined,
      primaryEmail: props.user.primaryEmail || undefined,
      primaryEmailVerified: props.user.primaryEmailVerified,
      signedUpAt: props.user.signedUpAt,
      clientMetadata: props.user.clientMetadata == null ? "" : JSON.stringify(props.user.clientMetadata, null, 2),
      clientReadOnlyMetadata: props.user.clientReadOnlyMetadata == null ? "" : JSON.stringify(props.user.clientReadOnlyMetadata, null, 2),
      serverMetadata: props.user.serverMetadata == null ? "" : JSON.stringify(props.user.serverMetadata, null, 2),
      passwordEnabled: props.user.hasPassword,
      otpAuthEnabled: props.user.otpAuthEnabled,
      updatePassword: false,
    };
  } else {
    defaultValues = {
      signedUpAt: new Date(),
      countryCode: null as string | null,
      botRiskScore: "",
      freeTrialAbuseRiskScore: "",
    };
  }

  const formSchema = yup.object({
    primaryEmail: emailSchema.label("Primary email").defined().nonEmpty(),
    displayName: yup.string().optional(),
    signedUpAt: yup.date().defined(),
    clientMetadata: jsonStringOrEmptySchema.default("null"),
    clientReadOnlyMetadata: jsonStringOrEmptySchema.default("null"),
    serverMetadata: jsonStringOrEmptySchema.default("null"),
    primaryEmailVerified: yup.boolean().optional(),
    password: passwordSchema.min(1).test({
      name: 'password-required',
      message: "Password is required",
      test: (value, context) => {
        if (context.parent.passwordEnabled && (context.parent.updatePassword || props.type === 'create')) {
          return value != null;
        }
        return true;
      },
    }).optional(),
    otpAuthEnabled: yup.boolean().test({
      name: 'otp-verified',
      message: "Primary email must be verified if OTP/magic link sign-in is enabled",
      test: (value, context) => {
        return context.parent.primaryEmailVerified || !value;
      },
    }).optional(),
    passwordEnabled: yup.boolean().optional(),
    updatePassword: yup.boolean().optional(),
    countryCode: countryCodeSchema.nullable().transform((value) => value === "" || value == null ? undefined : value).optional(),
    botRiskScore: yup.string().test({
      name: "bot-risk-score-format",
      message: "Bot risk score must be an integer between 0 and 100",
      test: (value) => validateRiskScore(value),
    }).optional(),
    freeTrialAbuseRiskScore: yup.string().test({
      name: "free-trial-risk-score-format",
      message: "Free trial abuse score must be an integer between 0 and 100",
      test: (value) => validateRiskScore(value),
    }).optional(),
  }).test({
    name: "risk-score-pair",
    message: "Bot risk score and free trial abuse score must both be provided or both be empty",
    test: (value) => {
      const botRiskScore = value.botRiskScore?.trim() ?? "";
      const freeTrialAbuseRiskScore = value.freeTrialAbuseRiskScore?.trim() ?? "";
      return (botRiskScore === "") === (freeTrialAbuseRiskScore === "");
    },
  });

  async function handleSubmit(values: yup.InferType<typeof formSchema>) {
    const normalizedCountryCode = values.countryCode ?? "";
    const normalizedBotRiskScore = values.botRiskScore?.trim() ?? "";
    const normalizedFreeTrialAbuseRiskScore = values.freeTrialAbuseRiskScore?.trim() ?? "";
    const userValues = {
      ...values,
      primaryEmailAuthEnabled: true,
      clientMetadata: values.clientMetadata ? JSON.parse(values.clientMetadata) : undefined,
      clientReadOnlyMetadata: values.clientReadOnlyMetadata ? JSON.parse(values.clientReadOnlyMetadata) : undefined,
      serverMetadata: values.serverMetadata ? JSON.parse(values.serverMetadata) : undefined,
      ...(props.type === "create" ? {
        countryCode: normalizedCountryCode === "" ? undefined : normalizedCountryCode,
        riskScores: normalizedBotRiskScore === "" && normalizedFreeTrialAbuseRiskScore === ""
          ? undefined
          : {
            signUp: {
              bot: Number(normalizedBotRiskScore),
              freeTrialAbuse: Number(normalizedFreeTrialAbuseRiskScore),
            },
          },
      } : {}),
    };

    try {
      if (props.type === 'edit') {
        await props.user.update(userValues);
      } else {
        await adminApp.createUser(userValues);
      }
    } catch (error) {
      if (KnownErrors.UserWithEmailAlreadyExists.isInstance(error)) {
        toast({
          title: "Email already exists",
          description: "Please choose a different email address",
          variant: "destructive",
        });
        return 'prevent-close';
      }
    }
  }

  return <FormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    trigger={props.trigger}
    title={props.type === 'edit' ? "Edit User" : "Create User"}
    formSchema={formSchema}
    defaultValues={defaultValues}
    okButton={{ label: props.type === 'edit' ? "Save" : "Create" }}
    render={(form) => (
      <>
        {props.type === 'edit' ? <Typography variant='secondary'>ID: {props.user.id}</Typography> : null}

        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <InputField control={form.control} label="Primary email" name="primaryEmail" required />
          </div>
          <div className="mb-2">
            <SwitchField control={form.control} label="Verified" name="primaryEmailVerified" />
          </div>
        </div>

        <InputField control={form.control} label="Display name" name="displayName" />

        <DateField control={form.control} label="Signed Up At" name="signedUpAt" />

        {project.config.magicLinkEnabled && <SwitchField control={form.control} label="OTP/magic link sign-in" name="otpAuthEnabled" />}
        {project.config.credentialEnabled && <SwitchField control={form.control} label="Password sign-in" name="passwordEnabled" />}
        {form.watch("passwordEnabled") && (
          props.type === 'edit' && !form.watch("password") && !form.watch("updatePassword") ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => form.setValue('updatePassword', true)}
            >
              Update Password
            </Button>
          ) : (
            <InputField
              control={form.control}
              label={props.type === 'edit' ? "New password" : "Password"}
              name="password"
              type="password"
              autoComplete="off"
            />
          )
        )}
        {!form.watch("primaryEmailVerified") && form.watch("otpAuthEnabled") && <Typography variant="secondary">Primary email must be verified if OTP/magic link sign-in is enabled</Typography>}

        {props.type === "create" && (
          <Accordion type="single" collapsible>
            <AccordionItem value="item-risk-and-geo">
              <AccordionTrigger>Risk and Geo</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <CountryCodeField control={form.control} label="Country code" name="countryCode" placeholder="Select country code..." />
                <div className="grid gap-4 md:grid-cols-2">
                  <InputField control={form.control} label="Risk score: bot" name="botRiskScore" placeholder="0-100" />
                  <InputField control={form.control} label="Risk score: free trial abuse" name="freeTrialAbuseRiskScore" placeholder="0-100" />
                </div>
                <Typography variant="secondary">
                  Optional admin-only values for imports or custom anti-abuse systems. Leave blank to use the defaults.
                </Typography>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <Accordion type="single" collapsible>
          <AccordionItem value="item-1">
            <AccordionTrigger>Metadata</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <TextAreaField
                rows={3}
                control={form.control}
                label="Client metadata"
                name="clientMetadata"
                placeholder="null"
                monospace
                helperText={
                  <>
                    Custom JSON clients can read and update; avoid sensitive data.{" "}
                    <StyledLink href={metadataDocsUrl} target="_blank">Learn more in the docs</StyledLink>.
                  </>
                }
              />
              <TextAreaField
                rows={3}
                control={form.control}
                label="Client read only metadata"
                name="clientReadOnlyMetadata"
                placeholder="null"
                monospace
                helperText={
                  <>
                    Custom JSON clients can read but only your backend can change.{" "}
                    <StyledLink href={metadataDocsUrl} target="_blank">Learn more in the docs</StyledLink>.
                  </>
                }
              />
              <TextAreaField
                rows={3}
                control={form.control}
                label="Server metadata"
                name="serverMetadata"
                placeholder="null"
                monospace
                helperText={
                  <>
                    Custom JSON reserved for server-side logic and never exposed to clients.{" "}
                    <StyledLink href={metadataDocsUrl} target="_blank">Learn more in the docs</StyledLink>.
                  </>
                }
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </>
    )}
    onSubmit={handleSubmit}
    cancelButton
  />;
}
