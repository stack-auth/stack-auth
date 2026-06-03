import { StackHandler } from "@hexclave/next";
import { stackServerApp } from "../../../hexclave";

export default function Handler(props: any) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}
