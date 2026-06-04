import { StackHandler } from "@hexclave/next";
import { hexclaveServerApp } from "../../../hexclave";

export default function Handler(props: any) {
  return (
    <div style={{ backgroundColor: "white", borderRadius: 4 }}>
      <StackHandler fullPage app={hexclaveServerApp} routeProps={props} />
    </div>
  );
}
