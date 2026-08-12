import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BooleanTrue,
  TvEventOccurrenceLifecycle,
  TvEventPresentationClass,
  TvEventType,
} from "@/generated/prisma/client";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import {
  synchronizeTvProfileAssignments,
  type TvEventOccurrenceRow,
} from "@/lib/tv-mode/events";
import {
  createTvProfile,
  deleteTvProfile,
  TvBuiltInProfileMutationError,
} from "@/lib/tv-mode/profiles";
import { globalPrismaClient } from "@/prisma-client";
import {
  getTvBuiltInProfile,
  type TvInterruptionPreferences,
  type TvProfileResource,
} from "@hexclave/shared/dist/interface/admin-tv-mode";

describe.sequential("TV presentation persistence (real DB)", () => {
  let firstTenancy: Tenancy;
  let secondTenancy: Tenancy;
  const projectIds: string[] = [];

  async function createTestTenancy(): Promise<Tenancy> {
    const projectId = `tv-persistence-${randomUUID()}`;
    const tenancyId = randomUUID();
    projectIds.push(projectId);
    await globalPrismaClient.project.create({
      data: {
        id: projectId,
        displayName: "TV Persistence Test",
        description: "",
        isProductionMode: false,
      },
    });
    await globalPrismaClient.tenancy.create({
      data: {
        id: tenancyId,
        projectId,
        branchId: "main",
        hasNoOrganization: BooleanTrue.TRUE,
      },
    });
    const tenancy = await getTenancy(tenancyId);
    if (tenancy == null) throw new Error("TV persistence test tenancy was not created");
    return tenancy;
  }

  async function createOccurrence(
    tenancyId: string,
    options?: { lifecycle?: "ACTIVE" | "RESOLVED", presentationClass?: "INCIDENT" | "CRITICAL_INCIDENT" },
  ): Promise<TvEventOccurrenceRow> {
    const id = randomUUID();
    const occurredAt = new Date("2026-07-31T10:00:00.000Z");
    const activatedAt = new Date("2026-07-31T10:01:00.000Z");
    const escalatedAt = options?.presentationClass === "CRITICAL_INCIDENT"
      ? new Date("2026-07-31T10:02:00.000Z")
      : null;
    const resolvedAt = options?.lifecycle === "RESOLVED"
      ? new Date("2026-07-31T10:03:00.000Z")
      : null;
    const presentationClass = options?.presentationClass ?? "INCIDENT";
    const lifecycle = options?.lifecycle ?? "ACTIVE";
    const created = await globalPrismaClient.tvEventOccurrence.create({
      data: {
        id,
        tenancyId,
        eventType: TvEventType.EMAIL_DELIVERY_DEGRADATION,
        presentationClass: presentationClass === "CRITICAL_INCIDENT"
          ? TvEventPresentationClass.CRITICAL_INCIDENT
          : TvEventPresentationClass.INCIDENT,
        lifecycle: lifecycle === "RESOLVED"
          ? TvEventOccurrenceLifecycle.RESOLVED
          : TvEventOccurrenceLifecycle.ACTIVE,
        deduplicationKey: `tv-persistence:${id}`,
        title: "Email Delivery Degraded",
        summary: "Test incident",
        metricLabel: "Delivery rate",
        metricValue: "90%",
        sourceLabel: "Hexclave email",
        aggregateEvidence: {},
        occurredAt,
        detectedAt: occurredAt,
        activatedAt,
        escalatedAt,
        resolvedAt,
      },
    });
    return {
      id: created.id,
      eventType: created.eventType,
      presentationClass: created.presentationClass,
      lifecycle: created.lifecycle,
      title: created.title,
      summary: created.summary,
      metricLabel: created.metricLabel,
      metricValue: created.metricValue,
      expectedRange: created.expectedRange,
      sourceLabel: created.sourceLabel,
      occurredAt: created.occurredAt,
      activatedAt: created.activatedAt,
      escalatedAt: created.escalatedAt,
      resolvedAt: created.resolvedAt,
      updatedAt: created.updatedAt,
    };
  }

  function profileWithTiming(id: string, timing: TvInterruptionPreferences["timing"]): TvProfileResource {
    const template = getTvBuiltInProfile("company-pulse");
    if (template == null) throw new Error("Company Pulse TV template is missing");
    return {
      ...template,
      id,
      configuration: {
        ...template.configuration,
        interruptionPreferences: {
          ...template.configuration.interruptionPreferences,
          timing,
        },
      },
    };
  }

  beforeEach(async () => {
    firstTenancy = await createTestTenancy();
    secondTenancy = await createTestTenancy();
  });

  afterEach(async () => {
    await globalPrismaClient.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
  });

  it("freezes one complete takeover, recovery, and Highlight deadline set under concurrent assignment", async () => {
    const occurrence = await createOccurrence(firstTenancy.id, {
      lifecycle: "RESOLVED",
      presentationClass: "CRITICAL_INCIDENT",
    });
    const profileId = randomUUID();
    const firstTiming: TvInterruptionPreferences["timing"] = {
      celebration: { takeoverSeconds: 60, animationSeconds: 3600, highlightSeconds: 21600 },
      incident: { takeoverSeconds: 30, recoveryTakeoverSeconds: 30, resolvedHighlightSeconds: 3600 },
      criticalIncident: { takeoverSeconds: 60, recoveryTakeoverSeconds: 60, resolvedHighlightSeconds: 21600 },
    };
    const secondTiming: TvInterruptionPreferences["timing"] = {
      celebration: { takeoverSeconds: 60, animationSeconds: 3600, highlightSeconds: 21600 },
      incident: { takeoverSeconds: 30, recoveryTakeoverSeconds: 30, resolvedHighlightSeconds: 3600 },
      criticalIncident: { takeoverSeconds: 120, recoveryTakeoverSeconds: 120, resolvedHighlightSeconds: 43200 },
    };
    const now = new Date("2026-07-31T10:03:05.000Z");

    await Promise.all([
      synchronizeTvProfileAssignments({
        tenancy: firstTenancy,
        profile: profileWithTiming(profileId, firstTiming),
        occurrences: [occurrence],
        now,
      }),
      synchronizeTvProfileAssignments({
        tenancy: firstTenancy,
        profile: profileWithTiming(profileId, secondTiming),
        occurrences: [occurrence],
        now,
      }),
    ]);

    const assigned = await globalPrismaClient.tvProfileEventPresentation.findUniqueOrThrow({
      where: { tenancyId_profileId_occurrenceId: { tenancyId: firstTenancy.id, profileId, occurrenceId: occurrence.id } },
    });
    const firstWriterSet = {
      takeoverEndsAt: new Date("2026-07-31T10:03:00.000Z"),
      recoveryEndsAt: new Date("2026-07-31T10:04:00.000Z"),
      highlightExpiresAt: new Date("2026-07-31T16:03:00.000Z"),
    };
    const secondWriterSet = {
      takeoverEndsAt: new Date("2026-07-31T10:04:00.000Z"),
      recoveryEndsAt: new Date("2026-07-31T10:05:00.000Z"),
      highlightExpiresAt: new Date("2026-07-31T22:03:00.000Z"),
    };
    expect([
      firstWriterSet,
      secondWriterSet,
    ]).toContainEqual({
      takeoverEndsAt: assigned.takeoverEndsAt,
      recoveryEndsAt: assigned.recoveryEndsAt,
      highlightExpiresAt: assigned.highlightExpiresAt,
    });

    await synchronizeTvProfileAssignments({
      tenancy: firstTenancy,
      profile: profileWithTiming(profileId, {
        ...secondTiming,
        criticalIncident: { takeoverSeconds: 30, recoveryTakeoverSeconds: 30, resolvedHighlightSeconds: 86400 },
      }),
      occurrences: [occurrence],
      now: new Date("2026-07-31T10:03:10.000Z"),
    });
    await expect(globalPrismaClient.tvProfileEventPresentation.findUniqueOrThrow({
      where: { tenancyId_profileId_occurrenceId: { tenancyId: firstTenancy.id, profileId, occurrenceId: occurrence.id } },
    })).resolves.toMatchObject({
      takeoverEndsAt: assigned.takeoverEndsAt,
      recoveryEndsAt: assigned.recoveryEndsAt,
      highlightExpiresAt: assigned.highlightExpiresAt,
    });
  });

  it("removes only the deleted saved profile's assignments", async () => {
    const template = getTvBuiltInProfile("company-pulse");
    if (template == null) throw new Error("Company Pulse TV template is missing");
    const profile = await createTvProfile(firstTenancy, {
      ...template.configuration,
      displayName: "Deletion Cleanup",
    });
    if (profile == null) throw new Error("TV profile persistence is unavailable");
    const firstOccurrence = await createOccurrence(firstTenancy.id);
    const secondOccurrence = await createOccurrence(secondTenancy.id);
    await globalPrismaClient.tvProfileEventPresentation.createMany({
      data: [
        { tenancyId: firstTenancy.id, profileId: profile.id, occurrenceId: firstOccurrence.id },
        { tenancyId: secondTenancy.id, profileId: profile.id, occurrenceId: secondOccurrence.id },
      ],
    });

    await expect(deleteTvProfile(firstTenancy, profile.id, profile.version)).resolves.toBe(true);
    await expect(globalPrismaClient.tvProfileEventPresentation.count({
      where: { tenancyId: firstTenancy.id, profileId: profile.id },
    })).resolves.toBe(0);
    await expect(globalPrismaClient.tvProfileEventPresentation.count({
      where: { tenancyId: secondTenancy.id, profileId: profile.id },
    })).resolves.toBe(1);
    await expect(globalPrismaClient.tvEventOccurrence.count({
      where: { id: { in: [firstOccurrence.id, secondOccurrence.id] } },
    })).resolves.toBe(2);
  });

  it("does not mutate built-in profile assignments", async () => {
    const occurrence = await createOccurrence(firstTenancy.id);
    await globalPrismaClient.tvProfileEventPresentation.create({
      data: { tenancyId: firstTenancy.id, profileId: "company-pulse", occurrenceId: occurrence.id },
    });

    await expect(deleteTvProfile(firstTenancy, "company-pulse", 1)).rejects.toBeInstanceOf(TvBuiltInProfileMutationError);
    await expect(globalPrismaClient.tvProfileEventPresentation.count({
      where: { tenancyId: firstTenancy.id, profileId: "company-pulse" },
    })).resolves.toBe(1);
  });

  it("deletes a saved profile that has no assignments", async () => {
    const template = getTvBuiltInProfile("company-pulse");
    if (template == null) throw new Error("Company Pulse TV template is missing");
    const profile = await createTvProfile(firstTenancy, {
      ...template.configuration,
      displayName: "No Assignment Cleanup",
    });
    if (profile == null) throw new Error("TV profile persistence is unavailable");

    await expect(deleteTvProfile(firstTenancy, profile.id, profile.version)).resolves.toBe(true);
  });
});
