export const PaymentsConcepts = () => {
  const badge = (text, color) => {
    const colors = {
      zinc: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
      violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
      amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
      emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
      sky: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
    };
    return (
      <span className={"inline-block rounded-full px-2 py-0.5 text-[11px] font-medium " + (colors[color] || colors.zinc)}>
        {text}
      </span>
    );
  };

  const itemPill = (qty, name) => (
    <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 dark:border-emerald-800 dark:bg-emerald-950/40">
      <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{qty} {name}</span>
    </div>
  );

  const priceTag = (amount, interval) => (
    <div className="flex items-baseline gap-1">
      <span className="text-[15px] font-semibold text-zinc-900 dark:text-white">{amount}</span>
      {interval ? <span className="text-[11px] text-zinc-500 dark:text-zinc-500">/ {interval}</span> : null}
    </div>
  );

  const productCard = (name, price, interval, items, isHighlight, badgeText, badgeColor) => (
    <div className={isHighlight
      ? "flex flex-col gap-2 rounded-xl border border-violet-300 bg-violet-50/50 p-3 dark:border-violet-700 dark:bg-violet-950/20"
      : "flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
    }>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-zinc-900 dark:text-white">{name}</span>
        {badgeText ? badge(badgeText, badgeColor) : null}
      </div>
      {priceTag(price, interval)}
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {items.map((item, i) => <span key={i}>{itemPill(item[0], item[1])}</span>)}
        </div>
      ) : null}
    </div>
  );

  const customerRow = (type, label, items, productName) => (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
        {type === "user" ? "U" : "T"}
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex items-center gap-3">
          {items.map((item, i) => (
            <span key={i} className="text-[11px] text-zinc-500 dark:text-zinc-500">
              {item[0]}: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{item[1]}</span>
            </span>
          ))}
        </div>
      </div>
      {badge(productName, "violet")}
    </div>
  );

  return (
    <div className="not-prose my-6 space-y-4">
      <div className="overflow-hidden rounded-2xl border border-zinc-950/10 dark:border-white/10">
        <div className="flex items-center justify-between border-b border-zinc-950/10 bg-zinc-950/[0.03] px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">Product Line</span>
            {badge("mutually exclusive", "zinc")}
          </div>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-500">"Plan"</span>
        </div>
        <div className="grid gap-2.5 p-3 sm:grid-cols-3">
          {productCard("Free", "$0", null, [["10", "credits"]], false, null, null)}
          {productCard("Pro", "$20", "mo", [["500", "credits"], ["5", "seats"]], true, "popular", "violet")}
          {productCard("Enterprise", "$99", "mo", [["5,000", "credits"], ["50", "seats"]], false, null, null)}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-zinc-950/10 dark:border-white/10">
          <div className="flex items-center justify-between border-b border-zinc-950/10 bg-zinc-950/[0.03] px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">Standalone Product</span>
              {badge("stackable", "amber")}
            </div>
          </div>
          <div className="p-3">
            {productCard("Credit Pack", "$5", null, [["100", "credits"]], false, "one-time", "amber")}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-950/10 dark:border-white/10">
          <div className="flex items-center justify-between border-b border-zinc-950/10 bg-zinc-950/[0.03] px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">Add-on</span>
              {badge("requires Pro", "sky")}
            </div>
          </div>
          <div className="p-3">
            {productCard("Priority Support", "$10", "mo", [], false, "subscription", "sky")}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-950/10 dark:border-white/10">
        <div className="border-b border-zinc-950/10 bg-zinc-950/[0.03] px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">Customers</span>
          <span className="ml-2 text-[11px] text-zinc-500 dark:text-zinc-500">item balances after purchase</span>
        </div>
        <div className="space-y-2 p-3">
          {customerRow("user", "alice@example.com", [["credits", "487"], ["seats", "5"]], "Pro")}
          {customerRow("team", "Acme Corp", [["credits", "4,832"], ["seats", "50"]], "Enterprise")}
        </div>
      </div>
    </div>
  );
};
