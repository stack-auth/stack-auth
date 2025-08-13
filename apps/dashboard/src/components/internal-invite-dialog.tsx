"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Typography, Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@stackframe/stack-ui";
import { yupObject, strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import * as yup from "yup";

export function InternalInviteDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const domains = project.config.domains;

  const formSchema = yupObject({
    email: strictEmailSchema("Please enter a valid email address").defined(),
    selected: yup.string().defined(),
    localhostPort: yup.number().test("required-if-localhost", "Required if localhost is selected", (value, context) => {
      return context.parent.selected === "localhost" ? value !== undefined : true;
    }),
    handlerPath: yup.string().optional(),
  });

  return (
    <FormDialog
      title="Invite teammate"
      description="Send a sign-in invitation to join your internal team. The email will contain a callback link to your selected domain."
      open={props.open}
      onOpenChange={props.onOpenChange}
      formSchema={formSchema}
      okButton={{ label: "Send invite" }}
      render={({ control, watch }) => (
        <div className="flex flex-col gap-6">
          <InputField
            control={control}
            name="email"
            label="Email"
            placeholder="name@example.com"
            required
          />
          <SelectField
            control={control}
            name="selected"
            label="Domain"
            options={[
              ...domains.map((domain, index) => ({ value: index.toString(), label: domain.domain })),
              ...(project.config.allowLocalhost ? [{ value: "localhost", label: "localhost" }] : []),
            ]}
            required
          />
          {watch("selected") === "localhost" && (
            <>
              <InputField
                control={control}
                name="localhostPort"
                label="Localhost Port"
                placeholder="3000"
                type="number"
                required
              />
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>Advanced</AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <InputField
                        label="Handler path"
                        name="handlerPath"
                        control={control}
                        placeholder='/handler'
                      />
                      <Typography variant="secondary" type="footnote">
                        Only modify this if you changed the default handler path in your app
                      </Typography>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </div>
      )}
      onSubmit={async (values) => {
        let baseUrl: string;
        let handlerPath: string;
        if (values.selected === "localhost") {
          baseUrl = `http://localhost:${values.localhostPort}`;
          handlerPath = values.handlerPath || '/handler';
        } else {
          const domain = domains[parseInt(values.selected)];
          baseUrl = domain.domain;
          handlerPath = domain.handlerPath;
        }
        const callbackUrl = new URL(handlerPath + '/sign-in', baseUrl).toString();
        await adminApp.sendSignInInvitationEmail(values.email, callbackUrl);
      }}
    />
  );
}
