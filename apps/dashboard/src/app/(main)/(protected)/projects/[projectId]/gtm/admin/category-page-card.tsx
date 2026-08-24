"use client";

import { DesignAlert, DesignBadge, DesignButton } from "@/components/design-components";
import { CopyPromptButton } from "@/components/ui";
import {
  discardGrowthAdminCategoryPageDraft,
  listGrowthAdminCategoryPages,
  publishGrowthAdminCategoryPage,
  saveGrowthAdminCategoryPageDraft,
  unpublishGrowthAdminCategoryPage,
} from "@/lib/growth/growth-api";
import { buildGrowthCategoryPagePrompt } from "@/lib/growth/growth-page-prompt";
import type { GrowthAdminCategoryPage, GrowthCategory, GrowthCategoryPageVersion, GrowthOverview } from "@/lib/growth/growth-types";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { GrowthDocumentActionsProvider, GrowthDocumentRenderer } from "../components/growth-document";

type PagesState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", pages: GrowthAdminCategoryPage[] };

const GrowthAdminCategoryPagesContext = createContext<{ state: PagesState, refresh: () => Promise<void> } | null>(null);

export function GrowthAdminCategoryPagesProvider(props: { app: object, projectId: string, children: ReactNode }) {
  const { app, projectId } = props;
  const [state, setState] = useState<PagesState>({ status: "loading" });
  const refresh = useCallback(async () => {
    const result = await Result.fromThrowingAsync(async () => await listGrowthAdminCategoryPages(app, projectId));
    if (result.status === "error") {
      captureError("growth-admin-category-pages-load", result.error);
      setState({ status: "error", message: result.error instanceof Error ? result.error.message : String(result.error) });
      return;
    }
    setState({ status: "loaded", pages: result.data });
  }, [app, projectId]);
  useEffect(() => {
    setState({ status: "loading" });
    runAsynchronously(refresh());
  }, [refresh]);
  return <GrowthAdminCategoryPagesContext.Provider value={{ state, refresh }}>{props.children}</GrowthAdminCategoryPagesContext.Provider>;
}

const EMPTY_DATA_JSON = "[]";

export type Seed = {
  key: string,
  mdx: string,
  dataJson: string,
  draftUpdatedAtMillis: number | null,
};

export function seedKeyOf(
  category: GrowthCategory,
  draft: { id: string, updatedAtMillis: number } | null,
  published: { id: string, updatedAtMillis: number } | null,
): string {
  const slot = (version: { id: string, updatedAtMillis: number } | null, empty: string) =>
    version == null ? empty : `${version.id}:${version.updatedAtMillis}`;
  return `${category}:${slot(draft, "no-draft")}:${slot(published, "no-live")}`;
}

export function hasUnsavedEdits(seed: Seed | null, text: { mdx: string, dataJson: string }): boolean {
  return seed != null && (text.mdx !== seed.mdx || text.dataJson !== seed.dataJson);
}

export function shouldSeedFromStored(args: {
  storedKey: string | null,
  seededKey: string | null,
  dirty: boolean,
  mutating: boolean,
}): boolean {
  return args.storedKey != null && args.storedKey !== args.seededKey && !args.dirty && !args.mutating;
}

export function isSupersededByStored(args: {
  storedKey: string | null,
  seededKey: string | null,
  dirty: boolean,
  mutating: boolean,
}): boolean {
  return args.storedKey != null && args.storedKey !== args.seededKey && args.dirty && !args.mutating;
}

export function expectedDraftUpdatedAtMillis(seed: Seed | null, draft: { updatedAtMillis: number } | null): number | null {
  return seed == null ? draft?.updatedAtMillis ?? null : seed.draftUpdatedAtMillis;
}

function initialSource(page: GrowthAdminCategoryPage | null): { mdx: string, dataJson: string } {
  const version = page?.draft ?? page?.published ?? null;
  if (version?.source == null) return { mdx: "", dataJson: EMPTY_DATA_JSON };
  return { mdx: version.source.sourceMdx, dataJson: JSON.stringify(version.source.data, null, 2) };
}

function StatusBadges(props: { page: GrowthAdminCategoryPage | null }) {
  const published = props.page?.published ?? null;
  const draft = props.page?.draft ?? null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {published == null
        ? <DesignBadge label="Not published" color="orange" size="sm" />
        : <DesignBadge label={`Live · v${published.version}`} color="green" size="sm" />}
      {draft != null && <DesignBadge label={`Draft · v${draft.version}`} color="cyan" size="sm" />}
    </div>
  );
}

function StaleSourceNotice(props: { version: GrowthCategoryPageVersion | null, label: string }) {
  const stale = props.version?.staleSourceIds ?? [];
  if (stale.length === 0) return null;
  return (
    <DesignAlert variant="warning">
      {stale.length} of the items the {props.label} was written from changed or were deleted since it was last saved. Re-copy the prompt and rewrite it before publishing.
    </DesignAlert>
  );
}

export function GrowthAdminCategoryPageCard(props: {
  app: object,
  projectId: string,
  category: GrowthCategory,
  overview: GrowthOverview,
  onPublishedChanged: () => Promise<void>,
}) {
  const context = useContext(GrowthAdminCategoryPagesContext)
    ?? throwErr("GrowthAdminCategoryPageCard must be rendered inside GrowthAdminCategoryPagesProvider.");
  const { app, projectId, category, overview } = props;

  const pages = context.state.status === "loaded" ? context.state.pages : [];
  const page = pages.find((candidate) => candidate.category === category) ?? null;

  const [mdx, setMdx] = useState("");
  const [dataJson, setDataJson] = useState(EMPTY_DATA_JSON);
  const [seeded, setSeeded] = useState<Seed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const seedKey = context.state.status === "loaded" ? seedKeyOf(category, page?.draft ?? null, page?.published ?? null) : null;
  const dirty = hasUnsavedEdits(seeded, { mdx, dataJson });
  const seedFrom = useCallback((key: string, page: GrowthAdminCategoryPage | null) => {
    const source = initialSource(page);
    setMdx(source.mdx);
    setDataJson(source.dataJson);
    setSeeded({ key, draftUpdatedAtMillis: page?.draft?.updatedAtMillis ?? null, ...source });
  }, []);
  const seededKey = seeded?.key ?? null;
  useEffect(() => {
    if (seedKey == null || !shouldSeedFromStored({ storedKey: seedKey, seededKey, dirty, mutating })) return;
    seedFrom(seedKey, page);
  }, [seedKey, seededKey, dirty, mutating, page, seedFrom]);

  const supersededByStored = isSupersededByStored({ storedKey: seedKey, seededKey, dirty, mutating });

  const findings = overview.findings.filter((item) => item.category === category);
  const notes = overview.notes.filter((item) => item.category === category);
  const actions = overview.actions.filter((item) => item.category === category);
  const score = overview.categories.find((item) => item.category === category)?.score ?? null;
  const prompt = buildGrowthCategoryPagePrompt({ category, score, findings, notes, actions });

  const run = async (label: string, mutation: () => Promise<void>) => {
    setError(null);
    setMutating(true);
    const result = await Result.fromThrowingAsync(mutation);
    if (result.status === "error") {
      captureError(label, result.error);
      setError(result.error instanceof Error ? result.error.message : String(result.error));
      setMutating(false);
      return;
    }
    await context.refresh();
    setMutating(false);
  };

  const previewVersion = page?.draft ?? page?.published ?? null;
  const preview = previewVersion?.document ?? null;
  const previewActions = previewVersion?.actions ?? [];

  return (
    <section className="mt-6 rounded-2xl border border-dashed border-foreground/[0.16] bg-foreground/[0.02] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold tracking-tight">Stage page</h4>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            What the customer reads under this stage. While a page is live, the suggestion and note lanes below are staff-only.
          </p>
        </div>
        <StatusBadges page={page} />
      </header>

      {context.state.status === "loading" && <div className="mt-4 h-24 animate-pulse rounded-xl bg-foreground/[0.04]" aria-busy="true" />}
      {context.state.status === "error" && (
        <div className="mt-4">
          <DesignAlert variant="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Could not load this project&apos;s stage pages: {context.state.message}</span>
              <DesignButton size="sm" variant="outline" onClick={context.refresh}>Retry</DesignButton>
            </div>
          </DesignAlert>
        </div>
      )}

      {context.state.status === "loaded" && (
        <div className="mt-4 space-y-4">
          {error != null && <DesignAlert variant="error">{error}</DesignAlert>}
          <StaleSourceNotice version={page?.draft ?? null} label="draft" />
          {page?.draft == null && <StaleSourceNotice version={page?.published ?? null} label="live page" />}
          {supersededByStored && seedKey != null && (
            <DesignAlert variant="warning">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>This stage&apos;s stored version changed after the editor was filled, so your unsaved edits below were kept rather than overwritten. Saving them will be rejected until you load the stored version.</span>
                <DesignButton size="sm" variant="outline" onClick={() => seedFrom(seedKey, page)}>Load stored version</DesignButton>
              </div>
            </DesignAlert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <CopyPromptButton content={prompt} size="sm" variant="outline">Copy stage prompt</CopyPromptButton>
            <span className="text-xs text-muted-foreground">
              {findings.length} findings · {notes.length} notes · {actions.length} actions
            </span>
          </div>

          <label className="block text-xs font-medium">
            Page source (growth-mdx-v1)
            <textarea
              className="mt-1 min-h-64 w-full rounded-xl border bg-background p-3 font-mono text-xs"
              placeholder="## What we found&#10;&#10;<ActionButton action=&quot;…&quot; />"
              value={mdx}
              onChange={(event) => setMdx(event.target.value)}
            />
          </label>
          <label className="block text-xs font-medium">
            Evidence data JSON
            <textarea
              className="mt-1 min-h-32 w-full rounded-xl border bg-background p-3 font-mono text-xs"
              value={dataJson}
              onChange={(event) => setDataJson(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <DesignButton
              size="sm"
              disabled={mdx.trim().length === 0}
              onClick={async () => await run("growth-admin-category-page-save", async () => {
                const data = JSON.parse(dataJson);
                if (!Array.isArray(data)) throw new Error("Evidence data must be a JSON array.");
                const savedMdx = mdx;
                const savedDataJson = dataJson;
                const saved = await saveGrowthAdminCategoryPageDraft(app, projectId, {
                  category,
                  sourceMdx: savedMdx,
                  data,
                  sourceFindingIds: [...findings, ...notes].map((item) => item.id),
                  sourceActionIds: actions.map((action) => action.id),
                  expectedDraftUpdatedAtMillis: expectedDraftUpdatedAtMillis(seeded, page?.draft ?? null),
                });
                setSeeded({
                  key: seedKeyOf(category, saved, page?.published ?? null),
                  mdx: savedMdx,
                  dataJson: savedDataJson,
                  draftUpdatedAtMillis: saved.updatedAtMillis,
                });
              })}
            >
              Save draft
            </DesignButton>
            <DesignButton
              size="sm"
              variant="outline"
              disabled={page?.draft == null}
              onClick={async () => await run("growth-admin-category-page-publish", async () => {
                const version = page?.draft?.version;
                if (version == null) throw new Error("Save a draft before publishing.");
                await publishGrowthAdminCategoryPage(app, projectId, category, version);
                await props.onPublishedChanged();
              })}
            >
              Publish draft
            </DesignButton>
            <DesignButton
              size="sm"
              variant="outline"
              disabled={page?.published == null}
              onClick={async () => await run("growth-admin-category-page-unpublish", async () => {
                await unpublishGrowthAdminCategoryPage(app, projectId, category);
                await props.onPublishedChanged();
              })}
            >
              Take page down
            </DesignButton>
            <DesignButton
              size="sm"
              variant="outline"
              disabled={page?.draft == null}
              onClick={async () => await run("growth-admin-category-page-discard", async () => {
                await discardGrowthAdminCategoryPageDraft(app, projectId, category);
              })}
            >
              Discard draft
            </DesignButton>
          </div>

          {(page?.archived.length ?? 0) > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] p-3">
              <p className="text-xs font-medium">Earlier versions</p>
              <ul className="mt-2 space-y-1.5">
                {page?.archived.map((version) => (
                  <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>v{version.version} · last saved {new Date(version.updatedAtMillis).toISOString().slice(0, 10)}</span>
                    <DesignButton
                      size="sm"
                      variant="outline"
                      onClick={async () => await run("growth-admin-category-page-rollback", async () => {
                        await publishGrowthAdminCategoryPage(app, projectId, category, version.version);
                        await props.onPublishedChanged();
                      })}
                    >
                      Publish this version
                    </DesignButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-foreground/[0.08] bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {page?.draft != null ? "Preview of the saved draft" : page?.published != null ? "The live page" : "Preview"}
            </p>
            {preview == null
              ? <p className="mt-2 text-xs text-muted-foreground">Save a draft to preview it exactly as the customer will see it.</p>
              : (
                <div className="mt-3">
                  <GrowthDocumentActionsProvider actions={previewActions} demo={false} projectId={null} onChanged={props.onPublishedChanged}>
                    <GrowthDocumentRenderer document={preview} className="max-w-3xl" />
                  </GrowthDocumentActionsProvider>
                </div>
              )}
          </div>
        </div>
      )}
    </section>
  );
}
