import { StackHandler } from "@hexclave/next"; 
import { stackServerApp } from "../../../hexclave/server"; 

export default function Handler(props: unknown) { 
   return <StackHandler fullPage app = { stackServerApp } routeProps = { props } />; 
 } 
