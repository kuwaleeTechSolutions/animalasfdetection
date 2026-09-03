// =====================================================================================
// RISK SCORING -- runs immediately after the contact-tracing engine (services/contactTracing.mts)
//
// Rule (documented per README "Risk Scoring Rule", all numbers configurable via the
// `settings` table / Admin > Settings screen, never hardcoded magic numbers):
//   1. Every ContactEdge for a premises contributes `pathwayWeights[pathway]` points.
//   2. Edges discovered at hop > 1 are discounted by `hopDecayFactor` per extra hop
//      (a hop-2-only contact is inherently less certain than a direct hop-1 contact).
//   3. A premises's final score = sum of all its (decayed) edge weights.
//   4. level = High if score >= riskThresholds.high
//            = Medium if score >= riskThresholds.medium
//            = Low otherwise
//
// Default weights give a direct animal movement (or trace-back/trace-forward) a
// score of 10 -> High on its own. A single shared vehicle or market contact scores
// 6 -> Medium on its own. A vet-visit-only or proximity-only contact scores 3 or 2
// -> Low unless it stacks with other pathways.
// =====================================================================================
import { ContactEdgeRepo, RiskScoreRepo } from '../repositories/caseRepo.mts';
import { SettingsRepo } from '../repositories/adminRepo.mts';
import { transaction } from '../repositories/dbHelpers.mts';

export interface RiskSummary {
  high: number;
  medium: number;
  low: number;
}

export function runRiskScoring(caseId: string): RiskSummary {
  const settings = SettingsRepo.getAll();
  const edges = ContactEdgeRepo.byCase(caseId);

  const byPremises = new Map<string, typeof edges>();
  for (const e of edges) {
    const list = byPremises.get(e.connected_premises_id) || [];
    list.push(e);
    byPremises.set(e.connected_premises_id, list);
  }

  RiskScoreRepo.clearForCase(caseId);

  const summary: RiskSummary = { high: 0, medium: 0, low: 0 };

  transaction(() => {
    for (const [premisesId, premisesEdges] of byPremises) {
      let score = 0;
      const pathwaysSeen = new Set<string>();
      for (const e of premisesEdges) {
        const baseWeight = settings.pathwayWeights[e.pathway] ?? 1;
        const decay = e.hop_count > 1 ? Math.pow(settings.hopDecayFactor, e.hop_count - 1) : 1;
        score += baseWeight * decay;
        pathwaysSeen.add(e.pathway);
      }

      let level: 'High' | 'Medium' | 'Low';
      if (score >= settings.riskThresholds.high) level = 'High';
      else if (score >= settings.riskThresholds.medium) level = 'Medium';
      else level = 'Low';

      summary[level === 'High' ? 'high' : level === 'Medium' ? 'medium' : 'low']++;

      const rationale = `Pathways: ${Array.from(pathwaysSeen).join(', ')} | weighted score = ${score.toFixed(1)} ` +
        `(High >= ${settings.riskThresholds.high}, Medium >= ${settings.riskThresholds.medium})`;

      RiskScoreRepo.upsert({ case_id: caseId, premises_id: premisesId, level, score, rationale });
    }
  });

  return summary;
}
