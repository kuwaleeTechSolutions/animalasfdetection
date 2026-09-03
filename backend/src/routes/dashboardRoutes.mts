import { App } from '../lib/http.mts';
import { requireAuth } from '../middleware/auth.mts';
import { CaseRepo, TraceRunRepo, RiskScoreRepo } from '../repositories/caseRepo.mts';
import { PremisesRepo } from '../repositories/coreRepo.mts';
import { TaskRepo } from '../repositories/opsRepo.mts';
import { CompensationRepo } from '../repositories/opsRepo.mts';
import { SettingsRepo } from '../repositories/adminRepo.mts';

function average(nums: number[]): number | null {
  const valid = nums.filter((n) => n != null && !Number.isNaN(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function registerDashboardRoutes(app: App) {
  // Command Dashboard: active outbreaks, epicentre map data, tasks-by-status funnel,
  // detection-to-alert time & contact-trace time (rolling averages), districts affected.
  app.get('/api/dashboard/summary', requireAuth, (req, res) => {
    const activeCases = CaseRepo.activeCases();
    const allPremises = PremisesRepo.all();
    const premisesById = new Map(allPremises.map((p) => [p.id, p]));
    const allTasks = TaskRepo.all();
    const traceRuns = TraceRunRepo.all();

    const districtsAffected = new Set(
      activeCases.map((c) => premisesById.get(c.premises_id)?.district).filter(Boolean)
    );

    const tasksByStatus = {
      open: allTasks.filter((t) => t.status === 'open').length,
      in_progress: allTasks.filter((t) => t.status === 'in_progress').length,
      completed: allTasks.filter((t) => t.status === 'completed').length,
    };

    const contactTraceMsAvg = average(traceRuns.map((r) => r.contact_trace_ms));
    const detectionToAlertSecondsAvg = average(traceRuns.map((r) => r.detection_to_alert_seconds).filter((v): v is number => v != null));

    // Epicentre map: every premises with an active (non ruled-out) case, plus its
    // highest-risk connected contact premises for map colour-coding.
    const epicentres = activeCases.map((c) => {
      const premises = premisesById.get(c.premises_id);
      const latestRun = TraceRunRepo.latestByCase(c.id);
      return {
        caseId: c.id, disease: c.disease, status: c.status, premises,
        connectedCount: latestRun?.premises_found_count ?? 0,
        highRisk: latestRun?.high_risk_count ?? 0,
        mediumRisk: latestRun?.medium_risk_count ?? 0,
        lowRisk: latestRun?.low_risk_count ?? 0,
      };
    });

    // Risk-scored / colour-coded map of ALL connected premises across all active cases.
    const riskMapPoints: any[] = [];
    for (const c of activeCases) {
      for (const score of RiskScoreRepo.byCase(c.id)) {
        const premises = premisesById.get(score.premises_id);
        if (premises) riskMapPoints.push({ caseId: c.id, premises, level: score.level, score: score.score });
      }
    }

    res.json({
      activeOutbreaksCount: activeCases.length,
      districtsAffectedCount: districtsAffected.size,
      districtsAffected: Array.from(districtsAffected),
      tasksByStatus,
      metrics: {
        contactTraceMsAvg,
        detectionToAlertSecondsAvg,
        traceRunCount: traceRuns.length,
      },
      epicentres,
      riskMapPoints,
      totalPremises: allPremises.length,
    });
  });

  app.get('/api/dashboard/trace-runs', requireAuth, (req, res) => {
    res.json({ traceRuns: TraceRunRepo.all() });
  });

  app.get('/api/dashboard/compensation-summary', requireAuth, (req, res) => {
    const records = CompensationRepo.all();
    const byStatus = {
      reported: records.filter((r) => r.status === 'reported').length,
      assessed: records.filter((r) => r.status === 'assessed').length,
      approved: records.filter((r) => r.status === 'approved').length,
      disbursed: records.filter((r) => r.status === 'disbursed').length,
    };
    res.json({ total: records.length, byStatus, totalAnimalsAffected: records.reduce((a, r) => a + r.animals_affected_count, 0) });
  });
}
