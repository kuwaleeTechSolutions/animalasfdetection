import { run, get, all, nowIso } from './dbHelpers.mts';
import { newId } from '../lib/ids.mts';

export interface DiseaseCase {
  id: string;
  premises_id: string;
  disease: string;
  status: 'suspected' | 'lab_confirmed' | 'ruled_out';
  reported_date: string;
  reported_by: string | null;
  lab_result_date: string | null;
  clinical_notes: string | null;
  created_at: string;
  updated_at: string;
}

export const CaseRepo = {
  create(data: Omit<DiseaseCase, 'id' | 'created_at' | 'updated_at'>): DiseaseCase {
    const id = newId('case');
    const ts = nowIso();
    run(
      `INSERT INTO disease_cases (id,premises_id,disease,status,reported_date,reported_by,lab_result_date,clinical_notes,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, data.premises_id, data.disease, data.status, data.reported_date, data.reported_by, data.lab_result_date, data.clinical_notes, ts, ts]
    );
    return this.getById(id)!;
  },
  getById(id: string): DiseaseCase | undefined { return get<DiseaseCase>('SELECT * FROM disease_cases WHERE id = ?', [id]); },
  all(): DiseaseCase[] { return all<DiseaseCase>('SELECT * FROM disease_cases ORDER BY created_at DESC'); },
  updateStatus(id: string, status: DiseaseCase['status'], labResultDate?: string): DiseaseCase | undefined {
    run('UPDATE disease_cases SET status = ?, lab_result_date = COALESCE(?, lab_result_date), updated_at = ? WHERE id = ?',
      [status, labResultDate || null, nowIso(), id]);
    return this.getById(id);
  },
  activeCases(): DiseaseCase[] {
    return all<DiseaseCase>("SELECT * FROM disease_cases WHERE status != 'ruled_out' ORDER BY created_at DESC");
  },
};

// ---------------------------------------------------------------------------
// CONTACT EDGES (computed)
// ---------------------------------------------------------------------------
export type Pathway = 'animal_movement' | 'transport_vehicle' | 'market' | 'veterinary_visit' | 'nearby_farm' | 'previous_farm' | 'destination_farm';

export interface ContactEdge {
  id: string;
  case_id: string;
  connected_premises_id: string;
  pathway: Pathway;
  hop_count: number;
  via_premises_id: string | null;
  detected_at: string;
  details_json: string | null;
}

export const ContactEdgeRepo = {
  create(data: Omit<ContactEdge, 'id' | 'detected_at'>): ContactEdge {
    const id = newId('edge');
    const ts = nowIso();
    run(
      `INSERT INTO contact_edges (id,case_id,connected_premises_id,pathway,hop_count,via_premises_id,detected_at,details_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, data.case_id, data.connected_premises_id, data.pathway, data.hop_count, data.via_premises_id, ts, data.details_json]
    );
    return get<ContactEdge>('SELECT * FROM contact_edges WHERE id = ?', [id])!;
  },
  byCase(caseId: string): ContactEdge[] {
    return all<ContactEdge>('SELECT * FROM contact_edges WHERE case_id = ? ORDER BY hop_count ASC', [caseId]);
  },
  clearForCase(caseId: string) {
    run('DELETE FROM contact_edges WHERE case_id = ?', [caseId]);
  },
};

// ---------------------------------------------------------------------------
// RISK SCORES
// ---------------------------------------------------------------------------
export interface RiskScore {
  id: string;
  case_id: string;
  premises_id: string;
  level: 'High' | 'Medium' | 'Low';
  score: number;
  rationale: string | null;
  computed_at: string;
}

export const RiskScoreRepo = {
  upsert(data: Omit<RiskScore, 'id' | 'computed_at'>): RiskScore {
    const existing = get<RiskScore>('SELECT * FROM risk_scores WHERE case_id = ? AND premises_id = ?', [data.case_id, data.premises_id]);
    const ts = nowIso();
    if (existing) {
      run('UPDATE risk_scores SET level=?, score=?, rationale=?, computed_at=? WHERE id=?',
        [data.level, data.score, data.rationale, ts, existing.id]);
      return get<RiskScore>('SELECT * FROM risk_scores WHERE id = ?', [existing.id])!;
    }
    const id = newId('risk');
    run('INSERT INTO risk_scores (id,case_id,premises_id,level,score,rationale,computed_at) VALUES (?,?,?,?,?,?,?)',
      [id, data.case_id, data.premises_id, data.level, data.score, data.rationale, ts]);
    return get<RiskScore>('SELECT * FROM risk_scores WHERE id = ?', [id])!;
  },
  byCase(caseId: string): RiskScore[] {
    return all<RiskScore>('SELECT * FROM risk_scores WHERE case_id = ? ORDER BY score DESC', [caseId]);
  },
  clearForCase(caseId: string) {
    run('DELETE FROM risk_scores WHERE case_id = ?', [caseId]);
  },
};

// ---------------------------------------------------------------------------
// TRACE RUNS (metrics)
// ---------------------------------------------------------------------------
export interface TraceRun {
  id: string;
  case_id: string;
  triggered_by: string;
  started_at: string;
  completed_at: string;
  contact_trace_ms: number;
  detection_to_alert_seconds: number | null;
  premises_found_count: number;
  edges_found_count: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  tasks_generated_count: number;
  created_at: string;
}

export const TraceRunRepo = {
  create(data: Omit<TraceRun, 'id' | 'created_at'>): TraceRun {
    const id = newId('trace');
    const ts = nowIso();
    run(
      `INSERT INTO trace_runs (id,case_id,triggered_by,started_at,completed_at,contact_trace_ms,detection_to_alert_seconds,
        premises_found_count,edges_found_count,high_risk_count,medium_risk_count,low_risk_count,tasks_generated_count,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.case_id, data.triggered_by, data.started_at, data.completed_at, data.contact_trace_ms, data.detection_to_alert_seconds,
        data.premises_found_count, data.edges_found_count, data.high_risk_count, data.medium_risk_count, data.low_risk_count,
        data.tasks_generated_count, ts]
    );
    return get<TraceRun>('SELECT * FROM trace_runs WHERE id = ?', [id])!;
  },
  byCase(caseId: string): TraceRun[] { return all<TraceRun>('SELECT * FROM trace_runs WHERE case_id = ? ORDER BY created_at DESC', [caseId]); },
  latestByCase(caseId: string): TraceRun | undefined {
    return get<TraceRun>('SELECT * FROM trace_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1', [caseId]);
  },
  all(): TraceRun[] { return all<TraceRun>('SELECT * FROM trace_runs ORDER BY created_at DESC'); },
};
