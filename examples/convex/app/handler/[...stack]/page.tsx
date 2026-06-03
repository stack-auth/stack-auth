import { StackHandler } from "@hexclave/next"; 
import { hexclaveServerApp } from "../../../hexclave/server"; 

export default function Handler(props: unknown) { 
   return <StackHandler fullPage app = { hexclaveServerApp } routeProps = { props } />; 
 } 
