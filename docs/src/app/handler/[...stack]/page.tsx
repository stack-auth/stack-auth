import { stackServerApp } from '@/stack';
import { StackHandler } from '@hexclave/next';

export default function Handler(props: unknown) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}
