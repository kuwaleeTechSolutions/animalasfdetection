import { App } from '../lib/http.mts';
import { requireAuth, requireRole, blockReadOnly } from '../middleware/auth.mts';
import { TaskRepo, CompensationRepo } from '../repositories/opsRepo.mts';
import { AuditRepo, UserRepo } from '../repositories/adminRepo.mts';
import { PremisesRepo } from '../repositories/coreRepo.mts';

function enrichTask(task: ReturnType<typeof TaskRepo.getById>) {
  if (!task) return task;
  const premises = PremisesRepo.getById(task.premises_id);
  const assignee = task.assigned_to ? UserRepo.getById(task.assigned_to) : undefined;
  return {
    ...task,
    premises_name: premises?.name ?? null,
    premises_district: premises?.district ?? null,
    premises_village: premises?.village ?? null,
    assignee_name: assignee?.name ?? null,
  };
}

export function registerOpsRoutes(app: App) {
  // ---------------------------------------------------------------------
  // FIELD TASKS (Task Board -- kanban; My Tasks -- mobile field officer view)
  // ---------------------------------------------------------------------
  app.get('/api/tasks', requireAuth, (req, res) => {
    const mine = req.query.get('mine');
    let tasks = mine === 'true' ? TaskRepo.byAssignee(req.user!.id) : TaskRepo.all();
    const status = req.query.get('status');
    if (status) tasks = tasks.filter((t) => t.status === status);
    // Field officers only see their own assigned tasks (spec §6 RBAC table).
    if (req.user!.role === 'field_officer' && mine !== 'true') {
      tasks = tasks.filter((t) => t.assigned_to === req.user!.id);
    }
    res.json({ count: tasks.length, tasks: tasks.map(enrichTask) });
  });

  app.get('/api/tasks/:id', requireAuth, (req, res) => {
    const task = TaskRepo.getById(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ task: enrichTask(task) });
  });

  app.post('/api/tasks', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.premises_id || !b.task_type) { res.status(400).json({ error: 'premises_id and task_type are required' }); return; }
    const task = TaskRepo.create({
      case_id: b.case_id || null, premises_id: b.premises_id, contact_edge_id: b.contact_edge_id || null,
      task_type: b.task_type, assigned_to: b.assigned_to || null, status: 'open', priority: b.priority || 'Medium',
      due_date: b.due_date || null, notes: b.notes || null, photo_url: b.photo_url || null, created_by: req.user!.id,
    });
    AuditRepo.log(req.user!.id, 'create', 'field_task', task.id, b);
    res.status(201).json({ task });
  });

  // Field officer updates task status (My Tasks / Task Detail mobile view): open -> in_progress -> completed.
  app.patch('/api/tasks/:id/status', requireAuth, blockReadOnly, (req, res) => {
    const { status, notes, photo_url } = req.body || {};
    if (!status) { res.status(400).json({ error: 'status is required' }); return; }
    const updated = TaskRepo.updateStatus(req.params.id, status, notes, photo_url);
    if (!updated) { res.status(404).json({ error: 'Task not found' }); return; }
    AuditRepo.log(req.user!.id, 'update', 'field_task', updated.id, { status, notes, hasPhoto: !!photo_url });
    res.json({ task: updated });
  });

  // District officer reassigns a task to a different field officer.
  app.patch('/api/tasks/:id/reassign', requireAuth, requireRole('district_officer', 'state_admin'), (req, res) => {
    const { assigned_to } = req.body || {};
    if (!assigned_to) { res.status(400).json({ error: 'assigned_to is required' }); return; }
    const updated = TaskRepo.reassign(req.params.id, assigned_to);
    if (!updated) { res.status(404).json({ error: 'Task not found' }); return; }
    AuditRepo.log(req.user!.id, 'reassign', 'field_task', updated.id, { assigned_to });
    res.json({ task: updated });
  });

  // ---------------------------------------------------------------------
  // COMPENSATION TRACKER (status tracking only -- no disbursement in pilot)
  // ---------------------------------------------------------------------
  app.get('/api/compensation', requireAuth, (req, res) => { res.json({ records: CompensationRepo.all() }); });

  app.get('/api/compensation/:id', requireAuth, (req, res) => {
    const rec = CompensationRepo.getById(req.params.id);
    if (!rec) { res.status(404).json({ error: 'Compensation record not found' }); return; }
    res.json({ record: rec });
  });

  app.post('/api/compensation', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.premises_id) { res.status(400).json({ error: 'premises_id is required' }); return; }
    const record = CompensationRepo.create({
      premises_id: b.premises_id, case_id: b.case_id || null, animals_affected_count: Number(b.animals_affected_count) || 0,
      status: b.status || 'reported', notes: b.notes || null, created_by: req.user!.id,
    });
    AuditRepo.log(req.user!.id, 'create', 'compensation_record', record.id, b);
    res.status(201).json({ record });
  });

  // District officer approves compensation assessments (spec §6 RBAC table).
  app.patch('/api/compensation/:id/status', requireAuth, requireRole('district_officer', 'state_admin'), (req, res) => {
    const { status, notes } = req.body || {};
    if (!status) { res.status(400).json({ error: 'status is required' }); return; }
    const updated = CompensationRepo.updateStatus(req.params.id, status, notes);
    if (!updated) { res.status(404).json({ error: 'Compensation record not found' }); return; }
    AuditRepo.log(req.user!.id, 'update', 'compensation_record', updated.id, { status, notes });
    res.json({ record: updated });
  });
}
