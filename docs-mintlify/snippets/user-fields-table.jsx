export const UserFieldsTable = () => {
  const fields = [
    { name: "id", type: "string", description: "Unique identifier — always use this for lookups, not email" },
    { name: "displayName", type: "string | null", description: "The user's display name" },
    { name: "primaryEmail", type: "string | null", description: "The user's email address (not guaranteed unique)" },
    { name: "primaryEmailVerified", type: "boolean", description: "Whether the email has been verified" },
    { name: "profileImageUrl", type: "string | null", description: "URL to the user's profile image" },
    { name: "signedUpAt", type: "Date", description: "When the user created their account" },
    { name: "clientMetadata", type: "any", description: "Custom data, readable/writable from client and server" },
    { name: "clientReadOnlyMetadata", type: "any", description: "Custom data, readable from client, writable only from server" },
    { name: "serverMetadata", type: "any", description: "Custom data, server-only (only on server-side user objects)" },
    { name: "hasPassword", type: "boolean", description: "Whether the user has a password set" },
    { name: "isAnonymous", type: "boolean", description: "Whether this is an anonymous user" },
    { name: "isRestricted", type: "boolean", description: "Hasn't completed onboarding requirements (e.g. email not verified)" },
  ];

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border border-zinc-950/10 dark:border-white/10">
      <div className="border-b border-zinc-950/10 bg-zinc-950/[0.03] px-4 py-3 text-sm font-medium text-zinc-950/80 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80">
        User object fields
      </div>
      <div className="divide-y divide-zinc-950/[0.06] dark:divide-white/[0.06]">
        {fields.map((field) => (
          <div key={field.name} className="flex items-baseline gap-4 px-4 py-2.5">
            <code className="shrink-0 text-[13px] font-semibold text-zinc-950 dark:text-white">
              {field.name}
            </code>
            <code className="shrink-0 text-[12px] text-zinc-500 dark:text-zinc-400">
              {field.type}
            </code>
            <span className="text-[13px] leading-snug text-zinc-600 dark:text-zinc-400">
              {field.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
