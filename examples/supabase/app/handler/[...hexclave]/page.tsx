import { StackHandler } from "@hexclave/next";
import { hexclaveServerApp } from "../../../hexclave";

export default function Handler(props: any) {
  return <StackHandler fullPage app={hexclaveServerApp} routeProps={props} />;
}
