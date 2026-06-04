import { Input, Label, SimpleTooltip, Textarea } from "..";
import { CopyButton } from "./copy-button";

export function CopyField(props: {
  value: string,
  label?: React.ReactNode,
  helper?: React.ReactNode,
  monospace?: boolean,
  fixedSize?: boolean,
} & ({
  type: "textarea",
  height?: number,
} | {
  type: "input",
})) {
  return (
    <div>
      {props.label && (
        <Label className="flex items-center gap-2 mb-2">
          {props.label}
          {props.helper && <SimpleTooltip type="info" tooltip={props.helper} />}
        </Label>
      )}
      {props.type === "textarea" ? (
        <div className="relative pr-2">
          <Textarea
            readOnly
            value={props.value}
            style={{
              height: props.height,
              fontFamily: props.monospace ? "ui-monospace, monospace" : "inherit",
              whiteSpace: props.monospace ? "pre" : "normal",
              resize: props.fixedSize ? "none" : "vertical"
            }}
          />
          <CopyButton content={props.value} className="absolute right-4 top-2" />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={props.value}
            style={{
              fontFamily: props.monospace ? "ui-monospace, monospace" : "inherit",
            }}
          />
          <CopyButton content={props.value} />
        </div>
      )}
    </div>
  );
}
