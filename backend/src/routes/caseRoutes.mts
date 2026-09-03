import { App } from '../lib/http.mts';
import { requireAuth, blockReadOnly } from '../middleware/auth.mts';
import { CaseRepo, ContactEdgeRepo, RiskScoreRepo, TraceRunRepo } from '../repositories/caseRepo.mts';
import { PremisesRepo } from '../repositories/coreRepo.mts';
import { TaskRepo } from '../repositories/opsRepo.mts';
import { AuditRepo } from '../repositories/adminRepo.mts';
import { runContactTracing } from '../services/contactTracing.mts';

export function registerCaseRoutes(app: App) {
  app.get('/api/cases', requireAuth, (req, res) => {
    res.json({ cases: CaseRepo.all() });
  });

  app.get('/api/cases/:id', requireAuth, (req, res) => {
    const c = CaseRepo.getById(req.params.id);
    if (!c) { res.status(404).json({ error: 'Case not found' }); return; }
    res.json({ case: c, premises: PremisesRepo.getById(c.premises_id) });
  });

  // Create a new suspected/confirmed disease case. Contact tracing runs automatically
  // and synchronously right after creation (spec §5: "When a DiseaseCase is created or
  // its status changes to lab_confirmed, run a contact-tracing job...").
  app.post('/api/cases', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.premises_id || !b.reported_date) { res.status(400).json({ error: 'premises_id and reported_date are required' }); return; }
    const diseaseCase = CaseRepo.create({
      premises_id: b.premises_id, disease: b.disease || 'ASF', status: b.status || 'suspected',
      reported_date: b.reported_date, reported_by: req.user!.id, lab_result_date: b.lab_result_date || null,
      clinical_notes: b.clinical_notes || null,
    });
    AuditRepo.log(req.user!.id, 'create', 'disease_case', diseaseCase.id, b);

    const traceResult = runContactTracing(diseaseCase.id, 'auto');
    res.status(201).json({ case: diseaseCase, trace: traceResult });
  });

  // Update case status (e.g. suspected -> lab_confirmed -> ruled_out). Re-triggers
  // contact tracing automatically on transition to lab_confirmed.
  app.patch('/api/cases/:id/status', requireAuth, blockReadOnly, (req, res) => {
    const { status, lab_result_date } = req.body || {};
    if (!status) { res.status(400).json({ error: 'status is required' }); return; }
    const updated = CaseRepo.updateStatus(req.params.id, status, lab_result_date);
    if (!updated) { res.status(404).json({ error: 'Case not found' }); return; }
    AuditRepo.log(req.user!.id, 'update', 'disease_case', updated.id, { status, lab_result_date });

    let traceResult = null;
    if (status === 'lab_confirmed') {
      traceResult = runContactTracing(updated.id, 'auto');
    }
    res.json({ case: updated, trace: traceResult });
  });

  // Manually re-run contact tracing for a case (e.g. after new movement/vet-visit data
  // has been logged since the last run).
  app.post('/api/cases/:id/retrace', requireAuth, blockReadOnly, (req, res) => {
    const c = CaseRepo.getById(req.params.id);
    if (!c) { res.status(404).json({ error: 'Case not found' }); return; }
    const traceResult = runContactTracing(c.id, 'manual_rerun');
    res.json({ trace: traceResult });
  });

  // Contact-trace results: ranked list + map data of every connected premises, with
  // ALL pathway tags surfaced, plus risk level and one-click task-generation status.
  app.get('/api/cases/:id/contacts', requireAuth, (req, res) => {
    const c = CaseRepo.getById(req.params.id);
    if (!c) { res.status(404).json({ error: 'Case not found' }); return; }

    // RBAC (spec §6): Field Veterinary Officers may only view contact-trace results
    // for cases where they have at least one assigned field task -- i.e. "their own
    // tasks only". District/State roles and policymakers see everything.
    if (req.user!.role === 'field_officer') {
      const myTasksForCase = TaskRepo.byCase(c.id).some((t) => t.assigned_to === req.user!.id);
      if (!myTasksForCase) {
        res.status(403).json({ error: 'You may only view contact-trace results for cases where you have an assigned field task.' });
        return;
      }
    }
    const edges = ContactEdgeRepo.byCase(c.id);
    const risks = RiskScoreRepo.byCase(c.id);
    const riskByPremises = new Map(risks.map((r) => [r.premises_id, r]));
    const tasks = TaskRepo.byCase(c.id);
    const taskByPremises = new Map(tasks.map((t) => [t.premises_id, t]));

    const byPremises = new Map<string, any>();
    for (const e of edges) {
      if (e.connected_premises_id === c.premises_id) continue; // never surface the index premises as a "contact"
      if (!byPremises.has(e.connected_premises_id)) {
        const premises = PremisesRepo.getById(e.connected_premises_id);
        byPremises.set(e.connected_premises_id, {
          premises,
          pathwaysMap: new Map<string, { pathway: string; hop: number; detectedAt: string; occurrences: number }>(),
          risk: riskByPremises.get(e.connected_premises_id) || null,
          task: taskByPremises.get(e.connected_premises_id) || null,
        });
      }
      const entry = byPremises.get(e.connected_premises_id);
      // Multiple discovery paths can independently surface the SAME pathway type
      // (e.g. a shared vehicle discovered "via" several different intermediate
      // premises). For the UI we collapse those to ONE badge per pathway type
      // (keeping the lowest/most-direct hop count), but keep an occurrence count
      // so officers can see how strongly-corroborated a pathway is.
      const existing = entry.pathwaysMap.get(e.pathway);
      if (!existing || e.hop_count < existing.hop) {
        entry.pathwaysMap.set(e.pathway, { pathway: e.pathway, hop: e.hop_count, detectedAt: e.detected_at, occurrences: (existing?.occurrences || 0) + 1 });
      } else {
        existing.occurrences += 1;
      }
    }

    const results = Array.from(byPremises.values())
      .map((entry) => ({ premises: entry.premises, risk: entry.risk, task: entry.task, pathways: Array.from(entry.pathwaysMap.values()) }))
      .sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0));
    const latestRun = TraceRunRepo.latestByCase(c.id);

    res.json({
      case: c,
      indexPremises: PremisesRepo.getById(c.premises_id),
      connectedPremises: results,
      traceRun: latestRun,
    });
  });

  // One-click "generate tasks" for the contact-trace results screen (idempotent --
  // generateTasksForCase already skips premises with an existing open/in_progress task).
  app.post('/api/cases/:id/generate-tasks', requireAuth, blockReadOnly, async (req, res) => {
    const { generateTasksForCase } = await import('../services/taskGeneration.mts');
    const c = CaseRepo.getById(req.params.id);
    if (!c) { res.status(404).json({ error: 'Case not found' }); return; }
    const created = generateTasksForCase(c.id);
    res.json({ tasksCreated: created.length, tasks: created });
  });
}
