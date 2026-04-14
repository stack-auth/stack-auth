export const HomePromptIsland = () => {
  const agentSetupPromptPlaceholder = `You are my coding agent.

Set up Stack Auth in this project.
- Install and configure Stack Auth
- Create initial authentication routes
- Add sign-in and sign-up UI
- Verify local development setup

Return the exact files changed and next steps.`;

  const onCopy = async (event) => {
    const button = event.currentTarget;
    await navigator.clipboard.writeText(agentSetupPromptPlaceholder);
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = "Copy prompt";
    }, 1300);
  };

  return (
    <div className="not-prose my-6 rounded-3xl border border-[#d7dff6] bg-gradient-to-br from-[#f6f8ff] via-[#f2f5ff] to-[#edf7ff] p-5 text-zinc-900 shadow-[0_20px_60px_-40px_rgba(50,70,150,0.35)] sm:p-7 dark:border-[#2c3751] dark:bg-gradient-to-br dark:from-[#0c1423] dark:via-[#111b2f] dark:to-[#0b212e] dark:text-zinc-100 dark:shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4f5f95] dark:text-[#8ea4d2]">
        Agent-first setup
      </p>

      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
        Start with a single prompt.
      </h1>
      <p className="mt-3 max-w-3xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
        Set up Stack Auth by copying the prompt below into your favorite coding agent.
      </p>

      <div className="relative mt-6">
        <textarea
          readOnly
          value={agentSetupPromptPlaceholder}
          className="h-28 w-full resize-none overflow-hidden rounded-2xl border border-[#cdd7f4] bg-white/75 px-4 py-3 pr-32 font-mono text-xs leading-6 text-zinc-700 outline-none backdrop-blur-sm sm:text-sm dark:border-[#33476d] dark:bg-black/20 dark:text-zinc-200"
        />
        <button
          type="button"
          onClick={onCopy}
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-lg border border-[#9fb5e4] bg-[#eaf1ff] px-3 py-1.5 text-xs font-semibold text-[#2a4272] transition-colors duration-150 hover:transition-none hover:bg-[#dde8ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f6ff] dark:border-[#3d5a91] dark:bg-[#12213d] dark:text-[#d5e6ff] dark:hover:bg-[#1a2e51] dark:focus-visible:ring-offset-[#0f1a2e]"
        >
          Copy prompt
        </button>
        <div className="pointer-events-none absolute inset-x-2 bottom-2 h-8 rounded-b-xl bg-gradient-to-t from-[#f4f7ff] to-transparent dark:from-[#0f1a2e]" />
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <a
          href="https://app.stack-auth.com"
          className="inline-flex items-center justify-center rounded-xl bg-[#1e2f57] px-5 py-3 text-sm font-semibold !text-[#eef4ff] no-underline transition-colors duration-150 hover:transition-none hover:bg-[#253a6b] dark:bg-[#1e2f57] dark:hover:bg-[#253a6b] dark:!text-[#eef4ff]"
        >
          Go to dashboard
        </a>
        <a
          href="/guides/getting-started/setup"
          className="inline-flex items-center justify-center rounded-xl border border-[#9fb5e4] bg-white/60 px-5 py-3 text-sm font-semibold text-[#1f3764] no-underline transition-colors duration-150 hover:transition-none hover:bg-white/85 dark:border-[#3d5a91] dark:bg-transparent dark:text-[#d7e7ff] dark:hover:bg-white/10"
        >
          Manual installation instructions
        </a>
      </div>
    </div>
  );
};
