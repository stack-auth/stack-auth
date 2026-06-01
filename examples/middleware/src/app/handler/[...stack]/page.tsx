import { StackHandler } from "@hexclave/next";
import { stackServerApp } from "../../../stack";

export default function Handler(props: any) {
  return (
    <div style={{ backgroundColor: "white", borderRadius: 4 }}>
      <StackHandler fullPage app={stackServerApp} routeProps={props} />
    </div>
  );
}
