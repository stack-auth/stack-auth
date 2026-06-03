import { stackServerApp } from "src/hexclave";

export default async function ProtectedPage() {
  await stackServerApp.getUser({ or: 'redirect' });
  return <div>This is protected. You can see this because you are signed in</div>;
}
