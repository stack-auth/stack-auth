import { StackHandler } from "@hexclave/next";
import { hexclaveServerApp } from "src/hexclave";

export default function Handler(props) {
  return (
    <StackHandler fullPage app={hexclaveServerApp} routeProps={props} />
  );
}
