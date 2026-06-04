import { hexclaveServerApp } from "src/hexclave";

export default async function ProtectedPage() {
  await hexclaveServerApp.getUser({ or: 'redirect' });
  return <div>This is protected. You can see this because you are signed in</div>;
}
