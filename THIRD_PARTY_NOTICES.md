# Third-party notices

## Estuary connectors (Data Warehouse catalogue)

`apps/backend/src/lib/data-warehouse/catalogue/corpus/` contains one reviewed
v2.1 fact record per source connector, extracted from the connector definitions in
[github.com/estuary/connectors](https://github.com/estuary/connectors).

That repository's README states: *"All connectors in this repository are dual
licensed under MIT or Apache 2.0 at your discretion."* Hexclave uses them under
the MIT option. Only the `source-*` connector directories were read; the
repository's shared Flow runtime libraries are covered by a different licence
(BSL 1.1, see its `LICENSE` / `LICENSE-BSL`) and were not used.

No connector implementation was copied or translated. The corpus records
configuration and protocol facts: transports, endpoint paths, credential
modes, stream identities, pull and pagination shapes, cursor semantics,
schedules, continuity risks, confidence, and explicit abstentions. Short source
snippets of at most three lines are retained as evidence for review.

The application validates and interprets this schema directly; there is no
generated or hand-edited intermediate manifest. Each record names its Estuary
source directory and cites the evidence for its non-null claims. The schema and
mining rules are preserved alongside the records in `MINING_SCHEMA.md`.

MIT License, Copyright 2021 Estuary Technologies, Inc.
