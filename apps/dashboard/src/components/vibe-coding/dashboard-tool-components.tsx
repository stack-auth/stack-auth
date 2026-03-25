import { Button, Card } from "@/components/ui";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ArrowCounterClockwiseIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useSyncExternalStore } from "react";

let setCurrentCodeRef: ((code: string) => void) | null = null;
let currentCodeRef: string = "";
const listeners: Set<() => void> = new Set();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useCurrentCode() {
  return useSyncExternalStore(subscribe, () => currentCodeRef);
}

function ToolRender({ args }: { args: { content: string } }) {
  const currentCode = useCurrentCode();
  const isActive = args.content === currentCode;

  return (
    <Card className={`flex items-center gap-2 p-4 justify-between transition-colors ${isActive ? "ring-1 ring-primary/30 bg-primary/[0.03]" : ""}`}>
      <span className="text-sm flex items-center gap-2">
        {isActive && <CheckCircleIcon className="size-4 text-primary" weight="fill" />}
        Updated dashboard
      </span>
      {!isActive && (
        <Button variant="ghost" size="icon" onClick={() => setCurrentCodeRef?.(args.content)}>
          <ArrowCounterClockwiseIcon className="size-4" />
        </Button>
      )}
    </Card>
  );
}

const ToolUI = makeAssistantToolUI<
  { content: string },
  "success"
>({
  toolName: "updateDashboard",
  render: (props) => <ToolRender args={props.args} />,
});

type DashboardToolUIProps = {
  setCurrentCode: (code: string) => void,
  currentCode: string,
}

export const DashboardToolUI = ({ setCurrentCode, currentCode }: DashboardToolUIProps) => {
  useEffect(() => {
    setCurrentCodeRef = setCurrentCode;
    return () => {
      setCurrentCodeRef = null;
    };
  }, [setCurrentCode]);

  useEffect(() => {
    currentCodeRef = currentCode;
    for (const listener of listeners) {
      listener();
    }
  }, [currentCode]);

  return <ToolUI />;
};
