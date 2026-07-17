export const usageEmailTemplateSource = `
  import { type } from "arktype";
  import { Heading, Section, Text } from "@react-email/components";
  import { Subject, NotificationCategory, Props } from "@stackframe/emails";

  export const variablesSchema = type({
    projectDisplayName: "string",
    itemDisplayName: "string",
    currentQuantity: "number",
    thresholdKind: "'near' | 'over'"
  });

  export function EmailTemplate({ variables }: Props<typeof variablesSchema.infer>) {
    const isOverLimit = variables.thresholdKind === "over";

    return (
      <>
        <Subject value={variables.itemDisplayName + " usage alert"} />
        <NotificationCategory value="Marketing" />
        <Section>
          <Heading as="h3" className="font-sans font-bold text-[20px] text-center py-4 px-6 m-0">
            {isOverLimit
              ? variables.itemDisplayName + " limit reached"
              : variables.itemDisplayName + " usage is running low"}
          </Heading>
          <Text className="font-sans font-normal text-[14px] text-center pt-2 px-6 pb-2 m-0 opacity-80">
            {isOverLimit
              ? "Your quota is at or below its limit."
              : "Your remaining usage is low."}
          </Text>
          <Text className="font-sans font-normal text-[14px] text-center px-6 pb-2 m-0 opacity-80">
            Current {variables.itemDisplayName} quantity: {variables.currentQuantity}
          </Text>
          <Text className="font-sans font-normal text-[12px] text-center px-6 pb-6 m-0 opacity-60">
            Review your plan in {variables.projectDisplayName} if you need more capacity.
          </Text>
        </Section>
      </>
    );
  }

  EmailTemplate.PreviewVariables = {
    projectDisplayName: "My Project",
    itemDisplayName: "API requests",
    currentQuantity: 10,
    thresholdKind: "near"
  } satisfies typeof variablesSchema.infer;
`;
