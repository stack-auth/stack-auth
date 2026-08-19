import type { GrowthDocument, GrowthDocumentBlock } from "./growth-document";

export type GrowthActionNarrativeSections = {
  hypothesis: GrowthDocumentBlock[],
  evidence: GrowthDocumentBlock[],
  experiment: GrowthDocumentBlock[],
};

const EVIDENCE_COMPONENTS = new Set(["Evidence", "Metric", "TrendChart", "ComparisonChart", "BreakdownChart"]);

/**
 * Action documents are model-authored, but their information architecture is not. Only the three
 * supported narrative components reach the action page; headings and free-standing prose cannot
 * create new sections or change their order. Metric and chart components count as evidence so
 * actions saved before the stricter authoring contract still retain their grounded data.
 */
export function getGrowthActionNarrativeSections(document: GrowthDocument): GrowthActionNarrativeSections {
  const sections: GrowthActionNarrativeSections = { hypothesis: [], evidence: [], experiment: [] };
  for (const block of document.blocks) {
    if (block.type !== "component") continue;
    if (block.name === "Hypothesis") {
      sections.hypothesis.push(block);
    } else if (EVIDENCE_COMPONENTS.has(block.name)) {
      sections.evidence.push(block);
    } else if (block.name === "Experiment") {
      sections.experiment.push(block);
    }
  }
  return sections;
}
