import { StackHandler } from "@hexclave/next";
import { stackServerApp } from "src/hexclave";

export default function Handler(props) {
  return (
    <StackHandler fullPage app={stackServerApp} routeProps={props} />
  );
}
