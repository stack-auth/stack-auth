import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { describe, expect, it } from "vitest";
import {
  buildGrowthDemoActions,
  buildGrowthDemoAutomations,
  buildGrowthDemoBriefs,
  buildGrowthDemoInterview,
  buildGrowthDemoMilestones,
  buildGrowthDemoReport,
  buildGrowthDemoStatus,
  GROWTH_DEMO_ACTION_WORKFLOW_ID,
  GROWTH_DEMO_NOW_MILLIS,
} from "./growth-demo-data";
import { getGrowthPhase, GROWTH_PHASES } from "./growth-status";

const NOW = GROWTH_DEMO_NOW_MILLIS;

describe("buildGrowthDemoStatus", () => {
  it.each(GROWTH_PHASES)("derives the %s phase from its own fixture", (phase) => {
    expect(getGrowthPhase(buildGrowthDemoStatus(phase, NOW))).toBe(phase);
  });

  it("is deterministic for a fixed now", () => {
    expect(buildGrowthDemoStatus("steady-state", NOW))
      .toEqual(buildGrowthDemoStatus("steady-state", NOW));
  });

  it("shows a partially-complete step checklist while analyzing", () => {
    const status = buildGrowthDemoStatus("analyzing", NOW);
    const steps = status.analysis.steps ?? throwErr("The analyzing fixture must always carry a step checklist.");
    expect(steps.some((step) => step.state === "done")).toBe(true);
    expect(steps.some((step) => step.state === "running")).toBe(true);
    expect(steps.some((step) => step.state === "pending")).toBe(true);
  });

  it("renders compute-metrics as its own block, never as a checklist row", () => {
    for (const phase of GROWTH_PHASES) {
      const status = buildGrowthDemoStatus(phase, NOW);
      // Mirrors the backend contract: compute-metrics is excluded from analysis.steps and carried in
      // the standalone computeMetrics block instead (null only when there is no run at all).
      expect((status.analysis.steps ?? []).some((step) => step.id === "compute-metrics")).toBe(false);
      expect(status.analysis.computeMetrics == null).toBe(status.analysis.steps == null);
    }
    const analyzing = buildGrowthDemoStatus("analyzing", NOW);
    expect(analyzing.analysis.computeMetrics?.state).toBe("running");
    expect(analyzing.analysis.computeMetrics?.metricLabels.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(buildGrowthDemoStatus("steady-state", NOW).analysis.computeMetrics?.state).toBe("done");
  });

  it("renders the integrations step as its own block, never as a checklist row", () => {
    for (const phase of GROWTH_PHASES) {
      const status = buildGrowthDemoStatus(phase, NOW);
      // Mirrors the backend contract: the integrations phase is excluded from analysis.steps and
      // carried in the standalone integrations block instead (null only when there is no run at all).
      expect((status.analysis.steps ?? []).some((step) => step.id === "integrations")).toBe(false);
      expect(status.analysis.integrations == null).toBe(status.analysis.steps == null);
    }
    // While analyzing, compute-metrics is still running, so the step must honestly be "pending"
    // (the backend only derives "waiting" once metrics settle); settled fixtures show "connected".
    expect(buildGrowthDemoStatus("analyzing", NOW).analysis.integrations?.state).toBe("pending");
    const steady = buildGrowthDemoStatus("steady-state", NOW).analysis.integrations;
    expect(steady?.state).toBe("connected");
  });

  it("carries a user-safe error message in the failed fixture", () => {
    const status = buildGrowthDemoStatus("analysis-failed", NOW);
    expect(status.analysis.errorMessage).toBeTruthy();
  });

  it("reports a healthy orchestration block for every phase, with an in-flight analysis run only while analyzing", () => {
    for (const phase of GROWTH_PHASES) {
      const orchestration = buildGrowthDemoStatus(phase, NOW).orchestration;
      expect(orchestration.workflows.map((workflow) => workflow.workflowId)).toEqual(["growth-analysis", "growth-daily-brief"]);
      for (const workflow of orchestration.workflows) {
        expect(workflow.exists).toBe(true);
        expect(workflow.edited).toBe(false);
        expect(workflow.lastFailedRunSummary).toBeNull();
        expect(workflow.activeWorkflowRunState).toBe(phase === "analyzing" && workflow.workflowId === "growth-analysis" ? "running" : null);
      }
    }
  });
});

describe("growth demo surface builders", () => {
  it("are deterministic for a fixed now", () => {
    for (const phase of GROWTH_PHASES) {
      expect(buildGrowthDemoInterview(phase, NOW)).toEqual(buildGrowthDemoInterview(phase, NOW));
    }
    expect(buildGrowthDemoReport(NOW)).toEqual(buildGrowthDemoReport(NOW));
    expect(buildGrowthDemoActions(NOW)).toEqual(buildGrowthDemoActions(NOW));
    expect(buildGrowthDemoBriefs(NOW)).toEqual(buildGrowthDemoBriefs(NOW));
    expect(buildGrowthDemoMilestones(NOW)).toEqual(buildGrowthDemoMilestones(NOW));
    expect(buildGrowthDemoAutomations(NOW)).toEqual(buildGrowthDemoAutomations(NOW));
  });

  it("uses unique ids across all fixture collections", () => {
    const ids = [
      buildGrowthDemoReport(NOW).id,
      ...buildGrowthDemoActions(NOW).map((action) => action.id),
      ...buildGrowthDemoBriefs(NOW).map((brief) => brief.id),
      ...buildGrowthDemoMilestones(NOW).map((milestone) => milestone.id),
      ...buildGrowthDemoAutomations(NOW).map((workflow) => workflow.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildGrowthDemoInterview", () => {
  it("carries an empty pending plan before the analysis has generated questions", () => {
    for (const phase of ["not-onboarded", "analyzing", "analysis-failed"] as const) {
      const interview = buildGrowthDemoInterview(phase, NOW);
      expect(interview.status).toBe("pending");
      expect(interview.questions).toEqual([]);
    }
  });

  it.each(GROWTH_PHASES)("matches the %s status fixture's answered count", (phase) => {
    const status = buildGrowthDemoStatus(phase, NOW);
    const interview = buildGrowthDemoInterview(phase, NOW);
    expect(interview.questions.filter((question) => question.answeredAtMillis != null)).toHaveLength(status.interview.answeredCount);
  });

  it("answers questions in plan order with option ids that exist on the question", () => {
    const interview = buildGrowthDemoInterview("interview", NOW);
    expect(interview.status).toBe("active");
    expect(interview.questions.map((question) => question.orderIndex)).toEqual(interview.questions.map((_, index) => index));
    for (const question of interview.questions) {
      if (question.answerOptionIds == null) continue;
      const optionIds = new Set(question.options.map((option) => option.id));
      expect(question.answerOptionIds.length).toBeGreaterThan(0);
      for (const answerId of question.answerOptionIds) expect(optionIds.has(answerId)).toBe(true);
      if (question.kind === "single") expect(question.answerOptionIds).toHaveLength(1);
      expect(question.answeredAtMillis).toBeLessThan(NOW);
    }
  });

  it("personalizes every generated question with an evidence sentence and a focused question", () => {
    const interview = buildGrowthDemoInterview("interview", NOW);
    for (const question of interview.questions) {
      const sentences = question.prompt.split(/[.!?](?:\s|$)/).filter((sentence) => sentence.trim().length > 0);
      expect(sentences).toHaveLength(2);
      expect(question.prompt).toMatch(/\?$/);
      expect(question.prompt.length).toBeLessThanOrEqual(300);
      expect(question.options.at(-1)).toMatchObject({ id: "other", label: "Other" });
    }
  });
});

describe("buildGrowthDemoStatus release states", () => {
  // The hold is the state a real customer spends most of a day in, so demo mode has to be able to
  // show it — it is the only fixture that exercises the "check back in about 24 hours" copy on the
  // timeline, the report page, the interview completion panel and the chat lock.
  it("makes report-ready the hold: nothing released, no report to open", () => {
    const status = buildGrowthDemoStatus("report-ready", NOW);
    expect(status.release.state).toBe("preparing");
    expect(status.latestReport).toBe(null);
    expect(status.latestBrief).toBe(null);
  });

  it("releases the workspace in steady state", () => {
    const status = buildGrowthDemoStatus("steady-state", NOW);
    expect(status.release.state).toBe("released");
    expect(status.latestReport).not.toBe(null);
  });

  it("keeps every pre-interview phase out of the hold copy", () => {
    for (const phase of ["not-onboarded", "analyzing", "analysis-failed", "interview"] as const) {
      expect(buildGrowthDemoStatus(phase, NOW).release.state).toBe("not_ready");
    }
  });
});

describe("buildGrowthDemoReport", () => {
  it("matches the released status fixture and includes the required action item mix", () => {
    // steady-state, not report-ready: report-ready is now the HOLD fixture (the report is written
    // but not released), so it deliberately carries no latestReport to match against.
    const status = buildGrowthDemoStatus("steady-state", NOW);
    const report = buildGrowthDemoReport(NOW);
    expect(report.id).toBe(status.latestReport?.id);
    expect(report.createdAtMillis).toBe(status.latestReport?.createdAtMillis);
    expect(report.actionItems.length).toBeGreaterThanOrEqual(3);
    expect(report.actionItems.some((action) => action.typeId === "run_ads")).toBe(true);
    const blog = report.actionItems.find((action) => action.typeId === "publish_blog") ?? throwErr("The demo report must include a publish_blog action.");
    // Idea-only, not a finished draft: an analysis run proposes the piece and the customer generates
    // the post on demand, so the fixture must exercise the pre-generation state.
    expect(blog.payload).toMatchObject({
      blog_idea: {
        title: expect.any(String),
        outline_summary: expect.any(String),
      },
    });
    expect(blog.payload).not.toHaveProperty("draft_markdown");
  });

  it("agrees with the status fixtures' action counts", () => {
    const actions = buildGrowthDemoActions(NOW);
    const reportReady = buildGrowthDemoStatus("report-ready", NOW);
    const steadyState = buildGrowthDemoStatus("steady-state", NOW);
    expect(actions.filter((action) => action.status === "proposed")).toHaveLength(reportReady.counts.suggestedActions);
    expect(actions.filter((action) => action.status === "active")).toHaveLength(steadyState.counts.activeActions);
    for (const action of actions) {
      expect(action.watchedMetrics.length).toBeGreaterThan(0);
      expect(action.status === "active").toBe(action.activatedAtMillis != null);
    }
  });
});

describe("buildGrowthDemoBriefs", () => {
  it("returns one brief per day, newest first, anchored at nowMillis", () => {
    const briefs = buildGrowthDemoBriefs(NOW);
    expect(briefs.length).toBeGreaterThanOrEqual(5);
    briefs.forEach((brief, index) => {
      expect(brief.date).toBe(new Date(NOW - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      expect(brief.createdAtMillis).toBeLessThan(NOW);
    });
  });

  it("keeps the newest brief unread and matching the steady-state status fixture", () => {
    const briefs = buildGrowthDemoBriefs(NOW);
    const status = buildGrowthDemoStatus("steady-state", NOW);
    expect(briefs[0].id).toBe(status.latestBrief?.id);
    expect(briefs[0].date).toBe(status.latestBrief?.date);
    expect(briefs[0].createdAtMillis).toBe(status.latestBrief?.createdAtMillis);
    expect(briefs[0].readAtMillis).toBeNull();
    for (const brief of briefs.slice(1)) expect(brief.readAtMillis).not.toBeNull();
  });
});

describe("buildGrowthDemoMilestones", () => {
  it("covers every source and status at least once", () => {
    const milestones = buildGrowthDemoMilestones(NOW);
    expect(new Set(milestones.map((milestone) => milestone.source))).toEqual(new Set(["default", "user", "agent"]));
    expect(new Set(milestones.map((milestone) => milestone.status))).toEqual(new Set(["armed", "reached", "disabled"]));
  });
});

describe("workflow-bearing demo action", () => {
  it("attaches exactly one automation, proposed and clean, to the re-engagement action", () => {
    const actions = buildGrowthDemoActions(NOW);
    const workflowBearing = actions.filter((action) => action.workflow != null);
    expect(workflowBearing).toHaveLength(1);
    const workflow = workflowBearing[0].workflow ?? throwErr("filtered to non-null above");
    expect(workflowBearing[0].status).toBe("proposed");
    expect(workflow.workflowId).toBe(GROWTH_DEMO_ACTION_WORKFLOW_ID);
    // The demo automation is a one-shot: its only trigger is the item's own activation event, and
    // it has never been deployed or run.
    expect(workflow.triggers).toEqual([{ type: "event", eventType: "custom.growth.action.dormant-reactivation" }]);
    expect(workflow.status).toBe("not_deployed");
    expect(workflow.lastRunState).toBeNull();
    expect(workflow.warnings).toEqual([]);
    expect(workflow.source).toContain(GROWTH_DEMO_ACTION_WORKFLOW_ID);
    expect(workflow.explanation.length).toBeGreaterThan(0);
    expect(workflow.rollbackNote.length).toBeGreaterThan(0);
  });
});

describe("buildGrowthDemoAutomations", () => {
  it("carries both canonical pipeline workflows plus at least one AI-authored growth workflow", () => {
    const automations = buildGrowthDemoAutomations(NOW);
    const ids = automations.map((workflow) => workflow.id);
    expect(ids).toContain("growth-analysis");
    expect(ids).toContain("growth-daily-brief");
    expect(ids.some((id) => id !== "growth-analysis" && id !== "growth-daily-brief")).toBe(true);
    for (const workflow of automations) {
      expect(workflow.id.startsWith("growth-")).toBe(true);
      expect(workflow.stats.runVolume14d).toHaveLength(14);
      expect(workflow.lastDeployedAtMillis).toBeLessThan(NOW);
      expect(workflow.triggers.length).toBeGreaterThan(0);
    }
  });
});
