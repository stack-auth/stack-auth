# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.

Q: How is the Email Template Editor structured?
A: It uses a hero-preview layout in `VibeCodeLayout` where the preview area dominates the screen. The code editor is hidden by default and accessible via a modal, while the AI assistant chat resides in a resizable right panel. Device viewport switching (Desktop/Tablet/Mobile) is integrated into the top toolbar.

Q: How can I improve AI design generations for emails?
A: Update the system prompts in the backend's chat adapters (e.g., `apps/backend/src/lib/ai-chat/email-template-adapter.ts`). Providing explicit design principles, Tailwind CSS best practices, and structured technical rules helps the AI generate more polished and consistent designs.
