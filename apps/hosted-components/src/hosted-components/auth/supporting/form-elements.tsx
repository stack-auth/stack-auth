import { Separator } from "~/components/ui";

export function FormWarningText(props: {
  text?: string | null,
}) {
  if (props.text == null || props.text.length === 0) {
    return null;
  }

  return (
    <p role="alert" className="mt-1.5 text-xs text-destructive">
      {props.text}
    </p>
  );
}

export function SeparatorWithText(props: {
  text: string,
}) {
  return (
    <div className="stack-scope my-6 flex items-center justify-center">
      <div className="flex-1">
        <Separator />
      </div>
      <div className="mx-2 text-sm text-muted-foreground">{props.text}</div>
      <div className="flex-1">
        <Separator />
      </div>
    </div>
  );
}
