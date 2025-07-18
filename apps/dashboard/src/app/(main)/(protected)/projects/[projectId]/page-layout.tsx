import { Typography } from "@stackframe/stack-ui";

export function PageLayout(props: {
  children?: React.ReactNode,
  title?: string,
  description?: string,
  actions?: React.ReactNode,
  fillWidth?: boolean,
} & ({
  fillWidth: true,
} | {
  width?: number,
})) {
  return (
    <div className="py-4 px-4 md:px-6 flex justify-center">
      <div
        className={"min-w-0"}
        style={{
          maxWidth: props.fillWidth ? undefined : (props.width ?? 1250),
          width: props.fillWidth ? '100%' : (props.width ?? 1250),
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
          <div>
            {props.title && <Typography type="h2">
              {props.title}
            </Typography>}
            {props.description && (
              <Typography type="p" variant="secondary">
                {props.description}
              </Typography>
            )}
          </div>
          {props.actions}
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {props.children}
        </div>
      </div>
    </div>
  );
}
