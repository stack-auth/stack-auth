import type { GrowthActionWorkflowTrigger } from "./growth-types";

/**
 * Pure display helpers for the automation surfaces (action detail, activation dialog, automations
 * page). Kept out of growth-format.ts so the frozen formatting module stays untouched, and pure so
 * the activation-dialog copy — which is safety-relevant (it tells the customer what will actually
 * run) — is unit-testable without rendering.
 */

/** Wire prefix of one-shot activation events (customEvent("growth.action.<slug>") on the wire). */
const GROWTH_ACTION_ACTIVATION_EVENT_PREFIX = "custom.growth.action.";

/**
 * One plain-English sentence fragment per trigger, for the activation dialog's "when does this
 * run" summary. The activation event gets the honest phrasing ("once, immediately when you
 * activate") because that is exactly when the growth app emits it; other triggers are described
 * mechanically rather than pretending to parse cron.
 */
export function humanizeGrowthWorkflowTrigger(trigger: GrowthActionWorkflowTrigger): string {
  if (trigger.type === "schedule") {
    return `on a schedule (cron \`${trigger.cron}\`, ${trigger.timezone})`;
  }
  if (trigger.eventType.startsWith(GROWTH_ACTION_ACTIVATION_EVENT_PREFIX)) {
    return "once, immediately when you activate this action";
  }
  if (trigger.eventType.startsWith("custom.")) {
    return `whenever the custom event \`${trigger.eventType}\` is sent`;
  }
  return `whenever a \`${trigger.eventType}\` event happens in your project`;
}

/** Joins the per-trigger fragments into the dialog's "Runs …" line. */
export function humanizeGrowthWorkflowTriggers(triggers: GrowthActionWorkflowTrigger[]): string {
  if (triggers.length === 0) {
    // A trigger-less workflow can never start; the backend validation should prevent this, but the
    // dialog must not lie if it ever slips through.
    return "never — this automation has no triggers";
  }
  return triggers.map(humanizeGrowthWorkflowTrigger).join(", and ");
}

// The exact prefix scanWorkflowSourceWarnings (backend) uses for domain warnings. Parsing display
// strings is deliberate: the wire's warnings array IS the contract, and the domain lines are the
// only machine-recoverable entries in it.
const EXTERNAL_DOMAIN_WARNING_PREFIX = "Source references external domain: ";

/**
 * Splits the backend's warning strings into the external domains the workflow calls out to (shown
 * as a matter-of-fact list in the activation dialog) and everything else (secret-looking literals
 * etc., shown as warnings proper).
 */
export function splitGrowthWorkflowWarnings(warnings: string[]): { externalDomains: string[], otherWarnings: string[] } {
  const externalDomains: string[] = [];
  const otherWarnings: string[] = [];
  for (const warning of warnings) {
    if (warning.startsWith(EXTERNAL_DOMAIN_WARNING_PREFIX)) {
      externalDomains.push(warning.slice(EXTERNAL_DOMAIN_WARNING_PREFIX.length));
    } else {
      otherWarnings.push(warning);
    }
  }
  return { externalDomains, otherWarnings };
}
