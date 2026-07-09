export const metadata = {
  title: "Comms Topics",
};

export default function Page() {
  const topics = [
    {
      title: "Workspace reply routing",
      summary: "Nimbus wants replies to route through the right workspace owner while preserving child-account context.",
      confidence: "94%",
      status: "open",
      messages: [
        ["Maya Chen", "Email", "Can Comms route replies to the workspace owner when the original message came from a child account?"],
        ["Your team", "Email", "Yes, we can preserve the original user context while routing the reply to the workspace owner."],
      ],
    },
    {
      title: "Webhook and API surfaces",
      summary: "Aster is validating which Comms identifiers appear in outbound webhook payloads.",
      confidence: "86%",
      status: "waiting",
      messages: [
        ["Omar Haddad", "Shared Slack", "Does the webhook payload include the topic id or do we need to call back into the API?"],
      ],
    },
    {
      title: "Discord-led launch planning",
      summary: "Forge Guild is testing Discord-first contact capture before product signup.",
      confidence: "78%",
      status: "open",
      messages: [
        ["Lina Park", "Discord", "If someone joins Discord before signing up, can we merge them into the same contact later?"],
      ],
    },
  ];
  const selectedTopic = topics[0];

  return (
    <div className="flex flex-1 min-h-0 flex-col px-6 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Topics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI groups inbound and outbound communication into topics, with manual merge and split overrides.
          </p>
        </div>
        <div className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-300">
          Presentation mock
        </div>
      </div>

      <div className="grid min-h-[720px] gap-4 xl:grid-cols-[360px_1fr]">
        <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Topics</div>
          <div className="space-y-1">
            {topics.map((topic, index) => (
              <button
                key={topic.title}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted/60 hover:transition-none ${index === 0 ? "bg-purple-500/[0.08]" : "text-muted-foreground"}`}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-foreground">{topic.title}</span>
                  <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px]">{topic.status}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{topic.summary}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">{topic.confidence} confidence</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/70">
          <div className="border-b border-border/60 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-2 flex gap-1.5">
                  <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300">routing</span>
                  <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300">enterprise</span>
                </div>
                <h2 className="text-lg font-semibold">{selectedTopic.title}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{selectedTopic.summary}</p>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg border border-border px-3 py-1.5 text-sm" type="button">Merge topics</button>
                <button className="rounded-lg border border-border px-3 py-1.5 text-sm" type="button">Split topic</button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {selectedTopic.messages.map(([sender, platform, text]) => (
              <div key={`${sender}-${text}`} className={sender === "Your team" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[78%] rounded-2xl border px-4 py-3 ${sender === "Your team" ? "border-blue-500/30 bg-blue-500/[0.08]" : "border-border/60 bg-foreground/[0.03]"}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold">{sender}</span>
                    <span className="text-[11px] text-muted-foreground">{platform}</span>
                  </div>
                  <p className="text-sm leading-6">{text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border/60 p-5">
            <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto]">
              <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm">
                <option>Email</option>
                <option>Shared Slack</option>
                <option>Discord</option>
                <option>Support ticket</option>
              </select>
              <textarea className="min-h-9 rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Compose a mock response in this topic..." />
              <button className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" type="button">Send mock reply</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
