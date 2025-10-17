# CLAUDE Knowledge Base

Q: How are the development ports derived now that STACK_PORT_PREFIX exists?
A: Host ports use `${STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${STACK_PORT_PREFIX:-81}29`, POP3 `${STACK_PORT_PREFIX:-81}30`, and OTLP `${STACK_PORT_PREFIX:-81}31` by default).
