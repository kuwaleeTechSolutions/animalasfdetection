import { run, get, all, nowIso } from './dbHelpers.mts';
import { newId } from '../lib/ids.mts';

// ---------------------------------------------------------------------------
// FIELD TASKS
// ---------------------------------------------------------------------------
export interface FieldTask {
  id: string;
  case_id: string | null;
  premises_id: string;
  contact_edge_id: string | null;
  task_type: 'inspect' | 'test' | 'quarantine' | 'restrict_movement';
  assigned_to: string | null;
  status: 'open' | 'in_progress' | 'completed';
  priority: 'High' | 'Medium' | 'Low';
  due_date: string | null;
  completed_at: string | null;
  notes: string | null;
  photo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const TaskRepo = {
  create(data: Omit<FieldTask, 'id' | 'created_at' | 'updated_at' | 'completed_at'>): FieldTask {
    const id = newId('task');
    const ts = nowIso();
    run(
      `INSERT INTO field_tasks (id,case_id,premises_id,contact_edge_id,task_type,assigned_to,status,priority,due_date,completed_at,notes,photo_url,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.case_id, data.premises_id, data.contact_edge_id, data.task_type, data.assigned_to, data.status, data.priority,
        data.due_date, null, data.notes, data.photo_url, data.created_by, ts, ts]
    );
    return this.getById(id)!;
  },
  getById(id: string): FieldTask | undefined { return get<FieldTask>('SELECT * FROM field_tasks WHERE id = ?', [id]); },
  all(): FieldTask[] { return all<FieldTask>('SELECT * FROM field_tasks ORDER BY created_at DESC'); },
  byAssignee(userId: string): FieldTask[] { return all<FieldTask>('SELECT * FROM field_tasks WHERE assigned_to = ? ORDER BY due_date ASC', [userId]); },
  byCase(caseId: string): FieldTask[] { return all<FieldTask>('SELECT * FROM field_tasks WHERE case_id = ?', [caseId]); },
  updateStatus(id: string, status: FieldTask['status'], notes?: string, photoUrl?: string): FieldTask | undefined {
    const completedAt = status === 'completed' ? nowIso() : null;
    run('UPDATE field_tasks SET status=?, completed_at=?, notes=COALESCE(?,notes), photo_url=COALESCE(?,photo_url), updated_at=? WHERE id=?',
      [status, completedAt, notes || null, photoUrl || null, nowIso(), id]);
    return this.getById(id);
  },
  reassign(id: string, userId: string): FieldTask | undefined {
    run('UPDATE field_tasks SET assigned_to=?, updated_at=? WHERE id=?', [userId, nowIso(), id]);
    return this.getById(id);
  },
};

// ---------------------------------------------------------------------------
// COMPENSATION RECORDS
// ---------------------------------------------------------------------------
export interface CompensationRecord {
  id: string;
  premises_id: string;
  case_id: string | null;
  animals_affected_count: number;
  status: 'reported' | 'assessed' | 'approved' | 'disbursed';
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const CompensationRepo = {
  create(data: Omit<CompensationRecord, 'id' | 'created_at' | 'updated_at'>): CompensationRecord {
    const id = newId('comp');
    const ts = nowIso();
    run(
      `INSERT INTO compensation_records (id,premises_id,case_id,animals_affected_count,status,notes,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, data.premises_id, data.case_id, data.animals_affected_count, data.status, data.notes, data.created_by, ts, ts]
    );
    return this.getById(id)!;
  },
  getById(id: string): CompensationRecord | undefined { return get<CompensationRecord>('SELECT * FROM compensation_records WHERE id = ?', [id]); },
  all(): CompensationRecord[] { return all<CompensationRecord>('SELECT * FROM compensation_records ORDER BY created_at DESC'); },
  updateStatus(id: string, status: CompensationRecord['status'], notes?: string): CompensationRecord | undefined {
    run('UPDATE compensation_records SET status=?, notes=COALESCE(?,notes), updated_at=? WHERE id=?', [status, notes || null, nowIso(), id]);
    return this.getById(id);
  },
};
