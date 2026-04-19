export const ClickableTableOfContents = ({ title, code }) => {
  const lines = String(code ?? "").replace(/\r\n/g, "\n").split("\n");

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border border-zinc-950/10 bg-zinc-950/[0.03] dark:border-white/10 dark:bg-white/[0.03]">
      {title ? (
        <div className="border-b border-zinc-950/10 px-4 py-3 text-sm font-medium text-zinc-950/80 dark:border-white/10 dark:text-white/80">
          {title}
        </div>
      ) : null}

      <pre className="overflow-x-auto px-2 py-3 text-[13px] leading-6 text-zinc-900 dark:text-zinc-100">
        <code>
          {lines.map((line, index) => {
            if (line.trim().startsWith("// NEXT_LINE_PLATFORM")) {
              return null;
            }

            const match = line.match(/^(.*?)(?:\s*\/\/\s*\$stack-link-to:(#[a-zA-Z0-9_-]+))\s*$/);
            const href = match?.[2] ?? null;
            const text = match?.[1] ?? line;

            if (text.trim() === "") {
              return <span key={`blank-${index}`} className="block h-6" />;
            }

            const content = (
              <span className="block whitespace-pre rounded-lg px-3 py-0.5">
                {text.replace(/\s+$/, "")}
              </span>
            );

            if (!href) {
              return (
                <span
                  key={`line-${index}`}
                  className="block text-zinc-700 dark:text-zinc-300"
                >
                  {content}
                </span>
              );
            }

            return (
              <a
                key={`line-${index}`}
                href={href}
                className="block no-underline transition-colors hover:bg-zinc-950/[0.04] hover:text-zinc-950 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                {content}
              </a>
            );
          })}
        </code>
      </pre>
    </div>
  );
};

export const CollapsibleTypesSection = ({
  type,
  property,
  signature,
  defaultOpen = false,
  deprecated = false,
  badge,
  children,
}) => {
  const id = `${String(type ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")}${String(property ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")}`;
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncWithHash = () => {
      if (window.location.hash === `#${id}`) {
        setIsOpen(true);
      }
    };

    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);

    return () => window.removeEventListener("hashchange", syncWithHash);
  }, [id]);

  const label = signature ? `${property}(${signature})` : property;
  const fullLabel = type ? `${type}.${label}` : label;

  return (
    <details
      id={id}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className={`not-prose my-4 scroll-mt-24 overflow-hidden rounded-2xl border bg-white dark:bg-zinc-950 ${deprecated ? "border-orange-400/40 dark:border-orange-500/30" : "border-zinc-950/10 dark:border-white/10"}`}
    >
      <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-3">
          <code className={`text-[15px] font-medium ${deprecated ? "text-zinc-500 line-through decoration-zinc-400/60 dark:text-zinc-400 dark:decoration-zinc-500/60" : "text-zinc-950 dark:text-white"}`}>{fullLabel}</code>
          <span className="ml-auto flex items-center gap-2">
            {deprecated ? (
              <Badge color="orange" size="sm" shape="pill">deprecated</Badge>
            ) : null}
            {badge ?? null}
            <span
              aria-hidden="true"
              className="text-sm text-zinc-500 transition-transform dark:text-zinc-400"
            >
              {isOpen ? "▾" : "›"}
            </span>
          </span>
        </div>
      </summary>

      <div className="border-t border-zinc-950/10 px-4 py-5 dark:border-white/10">
        {children}
      </div>
    </details>
  );
};

export const MethodLayout = ({ children }) => (
  <div className="grid gap-4 md:grid-cols-2 md:items-start xl:gap-6">
    {children}
  </div>
);

export const MethodContent = ({ children }) => (
  <div className="min-w-0 space-y-4">{children}</div>
);

export const MethodAside = ({ title, children }) => (
  <div className="min-w-0 self-start space-y-4 rounded-2xl border border-zinc-950/10 bg-zinc-950/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
    {title ? (
      <p className="m-0 text-sm font-medium text-zinc-950 dark:text-white">{title}</p>
    ) : null}
    <div className="space-y-4">{children}</div>
  </div>
);

export const AsideSection = ({ title, children }) => (
  <div className="space-y-3">
    {title ? (
      <p className="m-0 text-sm font-medium text-zinc-950 dark:text-white">{title}</p>
    ) : null}
    <div className="space-y-3">{children}</div>
  </div>
);

export const ContentSection = ({ title, children }) => (
  <div className="space-y-3">
    {title ? (
      <p className="m-0 text-sm font-medium text-zinc-950 dark:text-white">{title}</p>
    ) : null}
    <div className="space-y-3">{children}</div>
  </div>
);

export const MethodReturns = ({ type, children }) => (
  <ContentSection title="Returns">
    <code className="inline-flex rounded-md border border-zinc-950/10 bg-zinc-950/[0.04] px-2 py-0.5 text-[13px] font-medium text-zinc-950 dark:border-white/10 dark:bg-white/[0.08] dark:text-white">
      {type}
    </code>
    {children ? (
      <div className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{children}</div>
    ) : null}
  </ContentSection>
);
