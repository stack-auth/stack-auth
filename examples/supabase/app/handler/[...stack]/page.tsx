import { StackHandler } from "@hexclave/next";
import { stackServerApp } from "../../../stack";

export default function Handler(props: any) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}
