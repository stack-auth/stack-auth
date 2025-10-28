# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.
