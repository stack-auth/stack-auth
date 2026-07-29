import { AppTodoPage } from "../../app-todo-page";

export const metadata = { title: "Performance" };

export default function Page() {
  return <AppTodoPage title="Performance" description="Find slow operations and regressions across traces." />;
}
