import { EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";


export default function PageClient(props: { templateType: EmailTemplateType }) {
  return (
    <div>
      {props.templateType}
    </div>
  );
}
