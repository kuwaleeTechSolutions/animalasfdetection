// =====================================================================================
// TASK AUTO-GENERATION -- spec §5: "Auto-generate a FieldTask for each newly-discovered
// High and Medium risk premises (do not auto-task Low risk -- flag for officer review
// instead)."
// =====================================================================================
import { RiskScoreRepo } from '../repositories/caseRepo.mts';
import { TaskRepo } from '../repositories/opsRepo.mts';
import type { FieldTask } from '../repositories/opsRepo.mts';
import { PremisesRepo } from '../repositories/coreRepo.mts';
import { UserRepo } from '../repositories/adminRepo.mts';
import { CaseRepo } from '../repositories/caseRepo.mts';
import { AuditRepo } from '../repositories/adminRepo.mts';
import { run, all, transaction } from '../repositories/dbHelpers.mts';

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Picks an assignee: a field officer covering the premises' district, round-robin by current open task count. */
function pickAssignee(district: string): string | null {
  const officers = UserRepo.fieldOfficersInDistrict(district);
  if (officers.length === 0) return null;
  const loads = officers.map((o) => ({
    officer: o,
    openCount: all<{ c: number }>("SELECT COUNT(*) as c FROM field_tasks WHERE assigned_to = ? AND status != 'completed'", [o.id])[0]?.c ?? 0,
  }));
  loads.sort((a, b) => a.openCount - b.openCount);
  return loads[0].officer.id;
}

export function generateTasksForCase(caseId: string): FieldTask[] {
  const diseaseCase = CaseRepo.getById(caseId);
  if (!diseaseCase) return [];
  const scores = RiskScoreRepo.byCase(caseId);
  const created: FieldTask[] = [];

  // Avoid duplicate auto-tasks if tracing is re-run: skip premises that already have
  // an open/in_progress task for this case.
  const existing = TaskRepo.byCase(caseId);
  const alreadyTasked = new Set(existing.filter((t) => t.status !== 'completed').map((t) => t.premises_id));

  transaction(() => {
    for (const score of scores) {
      if (score.level === 'Low') continue; // Low risk: flagged for review, not auto-tasked
      if (alreadyTasked.has(score.premises_id)) continue;

      const premises = PremisesRepo.getById(score.premises_id);
      if (!premises) continue;

      const taskType: FieldTask['task_type'] = score.level === 'High' ? 'quarantine' : 'inspect';
      const dueInDays = score.level === 'High' ? 1 : 3;
      const assignee = pickAssignee(premises.district);

      const task = TaskRepo.create({
        case_id: caseId,
        premises_id: premises.id,
        contact_edge_id: null,
        task_type: taskType,
        assigned_to: assignee,
        status: 'open',
        priority: score.level,
        due_date: addDays(new Date().toISOString(), dueInDays),
        notes: `Auto-generated from contact trace of case ${caseId} (${diseaseCase.disease}). ${score.rationale}`,
        photo_url: null,
        created_by: null,
      });
      created.push(task);
      AuditRepo.log(null, 'auto_create', 'field_task', task.id, { caseId, premisesId: premises.id, risk: score.level });
    }
  });

  return created;
}
