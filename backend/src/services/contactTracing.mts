// =====================================================================================
// CONTACT-TRACING ENGINE -- the core differentiator of this platform.
//
// Given a DiseaseCase, walks the movement/contact graph outward from the case's
// premises and returns every other premises connected to it through any of the
// 7 pathways described in the spec, up to a configurable number of BFS hops.
//
// Algorithm summary (documented in detail in README.md "Contact-Tracing Algorithm"):
//   1. reference date = case.lab_result_date ?? case.reported_date
//   2. hop 1: check all 7 pathway rules directly against the case premises.
//      - animal_movement direct edges are tagged 'previous_farm' (incoming animal's
//        origin) or 'destination_farm' (outgoing animal's destination) at hop 1,
//        since these are literally the trace-back / trace-forward pathways named
//        in the spec (#6 and #7). Any other direct movement not matching the
//        case's own animal chain is tagged 'animal_movement' (#1).
//      - transport_vehicle (#2): other premises whose movements used the same
//        vehicle as a movement touching the case premises, within the lookback window.
//      - market (#3): other premises whose animals passed through the same market
//        premises as the case premises, within the lookback window.
//      - veterinary_visit (#4): other premises visited by the same veterinarian
//        within the lookback window.
//      - nearby_farm (#5): other premises within the configurable radius (haversine).
//   3. hop 2 (if maxHops >= 2): repeat the SAME 7 checks from each hop-1 premises
//      (as if it were a new index node), tagging discoveries as hop 2. At hop > 1,
//      trace-back/trace-forward distinction collapses to the generic
//      'animal_movement' tag (those pathways are specifically about the ORIGINAL
//      case premises' own animals).
//   4. A premises can be discovered via multiple (pathway, hop) combinations -- ALL
//      of them are recorded as separate ContactEdge rows (spec: "surface all of
//      them in the UI, don't just show the first match").
//   5. Risk scoring and task generation run immediately after tracing completes
//      (see services/riskScoring.mts and services/taskGeneration.mts).
//
// This runs as an in-memory BFS over SQL-queried adjacency (spec explicitly allows
// "SQL recursive queries or an in-memory graph traversal (BFS)... no need for a
// dedicated graph database at pilot scale").
// =====================================================================================
import { PremisesRepo } from '../repositories/coreRepo.mts';
import { MovementRepo, AnimalRepo, VetVisitRepo } from '../repositories/coreRepo.mts';
import { CaseRepo, ContactEdgeRepo, TraceRunRepo } from '../repositories/caseRepo.mts';
import type { Pathway } from '../repositories/caseRepo.mts';
import { SettingsRepo } from '../repositories/adminRepo.mts';
import { haversineGeoRepository } from '../lib/geo.mts';
import { runRiskScoring } from './riskScoring.mts';
import { generateTasksForCase } from './taskGeneration.mts';
import { AuditRepo } from '../repositories/adminRepo.mts';
import { transaction } from '../repositories/dbHelpers.mts';

interface DiscoveredContact {
  premisesId: string;
  pathway: Pathway;
  hop: number;
  viaPremisesId: string;
  details: Record<string, any>;
}

function withinWindow(dateIso: string, referenceDateIso: string, windowDays: number): boolean {
  const d = new Date(dateIso).getTime();
  const ref = new Date(referenceDateIso).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return d <= ref && d >= ref - windowMs;
}

/**
 * Finds every premises directly connected to `centerId` through the 7 pathway
 * rules, evaluated against the lookback window ending at `referenceDate`.
 * `isRootCase` controls whether direct animal-movement edges get tagged with the
 * specific trace-back/trace-forward pathway names (only meaningful relative to the
 * actual case premises) or the generic 'animal_movement' tag (for indirect hops).
 */
function findDirectContacts(
  centerId: string,
  referenceDate: string,
  windowDays: number,
  radiusKm: number,
  isRootCase: boolean
): DiscoveredContact[] {
  const found: DiscoveredContact[] = [];
  const center = PremisesRepo.getById(centerId);
  if (!center) return found;

  // ---- Pathway #1 / #6 / #7: animal movement (direct, previous_farm, destination_farm) ----
  const movements = MovementRepo.touchingPremises(centerId).filter((m) => withinWindow(m.event_date, referenceDate, windowDays));
  const marketIdsTouchedByCenter = new Set<string>();
  for (const m of movements) {
    const otherId = m.from_premises_id === centerId ? m.to_premises_id : m.from_premises_id;
    if (otherId === centerId) continue;
    const otherPremises = PremisesRepo.getById(otherId);
    if (otherPremises?.premises_type === 'market') marketIdsTouchedByCenter.add(otherId);

    let pathway: Pathway = 'animal_movement';
    if (isRootCase) {
      pathway = m.to_premises_id === centerId ? 'previous_farm' : 'destination_farm';
    }
    found.push({
      premisesId: otherId,
      pathway,
      hop: 0, // filled in by caller
      viaPremisesId: centerId,
      details: { movement_id: m.id, event_date: m.event_date, animal_id: m.animal_id },
    });
  }

  // ---- Pathway #2: shared transport vehicle ----
  const vehicleIds = new Set(movements.map((m) => m.vehicle_id).filter((v): v is string => !!v));
  for (const vehicleId of vehicleIds) {
    const vehicleMovements = MovementRepo.byVehicle(vehicleId).filter((m) => withinWindow(m.event_date, referenceDate, windowDays));
    for (const m of vehicleMovements) {
      for (const otherId of [m.from_premises_id, m.to_premises_id]) {
        if (otherId === centerId) continue;
        found.push({
          premisesId: otherId,
          pathway: 'transport_vehicle',
          hop: 0,
          viaPremisesId: centerId,
          details: { vehicle_id: vehicleId, movement_id: m.id, event_date: m.event_date },
        });
      }
    }
  }

  // ---- Pathway #3: shared market ----
  for (const marketId of marketIdsTouchedByCenter) {
    const marketMovements = MovementRepo.touchingPremises(marketId).filter((m) => withinWindow(m.event_date, referenceDate, windowDays));
    for (const m of marketMovements) {
      for (const otherId of [m.from_premises_id, m.to_premises_id]) {
        if (otherId === centerId || otherId === marketId) continue;
        found.push({
          premisesId: otherId,
          pathway: 'market',
          hop: 0,
          viaPremisesId: centerId,
          details: { market_id: marketId, movement_id: m.id, event_date: m.event_date },
        });
      }
    }
  }

  // ---- Pathway #4: shared veterinary visit ----
  const centerVisits = VetVisitRepo.byPremises(centerId).filter((v) => withinWindow(v.visit_date, referenceDate, windowDays));
  const vetIds = new Set(centerVisits.map((v) => v.veterinarian_id));
  for (const vetId of vetIds) {
    const vetVisits = VetVisitRepo.byVet(vetId).filter((v) => withinWindow(v.visit_date, referenceDate, windowDays));
    for (const v of vetVisits) {
      if (v.premises_id === centerId) continue;
      found.push({
        premisesId: v.premises_id,
        pathway: 'veterinary_visit',
        hop: 0,
        viaPremisesId: centerId,
        details: { veterinarian_id: vetId, visit_id: v.id, visit_date: v.visit_date },
      });
    }
  }

  // ---- Pathway #5: geographic proximity ----
  const allPremises = PremisesRepo.all().map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }));
  const nearbyIds = haversineGeoRepository.withinRadiusKm({ lat: center.lat, lng: center.lng }, radiusKm, allPremises, centerId);
  for (const nearId of nearbyIds) {
    found.push({
      premisesId: nearId,
      pathway: 'nearby_farm',
      hop: 0,
      viaPremisesId: centerId,
      details: { radius_km: radiusKm },
    });
  }

  return found;
}

export interface TraceResult {
  caseId: string;
  edges: { premisesId: string; pathway: Pathway; hop: number; viaPremisesId: string }[];
  connectedPremisesIds: string[];
  contactTraceMs: number;
  detectionToAlertSeconds: number | null;
  traceRunId: string;
}

export function runContactTracing(caseId: string, triggeredBy: 'auto' | 'manual_rerun' = 'auto'): TraceResult {
  const startedAt = new Date();
  const t0 = process.hrtime.bigint();

  const diseaseCase = CaseRepo.getById(caseId);
  if (!diseaseCase) throw new Error(`Case not found: ${caseId}`);

  const settings = SettingsRepo.getAll();
  const referenceDate = diseaseCase.lab_result_date || diseaseCase.reported_date;

  // Clear any previous trace artifacts for this case before recomputing (idempotent re-run).
  ContactEdgeRepo.clearForCase(caseId);

  const allEdges: { premisesId: string; pathway: Pathway; hop: number; viaPremisesId: string; details: Record<string, any> }[] = [];
  const visited = new Set<string>([diseaseCase.premises_id]);
  let frontier = [diseaseCase.premises_id];

  for (let hop = 1; hop <= settings.maxHops; hop++) {
    const nextFrontier: string[] = [];
    if (process.env.DEBUG_TRACE_PERF) console.log(`[trace] hop ${hop}: frontier size = ${frontier.length}`);
    for (const node of frontier) {
      const isRoot = node === diseaseCase.premises_id && hop === 1;
      const contacts = findDirectContacts(node, referenceDate, settings.lookbackWindowDays, settings.proximityRadiusKm, isRoot);
      for (const c of contacts) {
        allEdges.push({ ...c, hop });
        if (!visited.has(c.premisesId)) {
          visited.add(c.premisesId);
          nextFrontier.push(c.premisesId);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Persist every (premises, pathway, hop) combination as its own ContactEdge row.
  // Batched in a single transaction -- see dbHelpers.transaction() perf note.
  const seenTriples = new Set<string>();
  transaction(() => {
    for (const e of allEdges) {
      const key = `${e.premisesId}|${e.pathway}|${e.hop}|${e.viaPremisesId}`;
      if (seenTriples.has(key)) continue; // avoid exact duplicate rows from overlapping discovery paths
      seenTriples.add(key);
      ContactEdgeRepo.create({
        case_id: caseId,
        connected_premises_id: e.premisesId,
        pathway: e.pathway,
        hop_count: e.hop,
        via_premises_id: e.viaPremisesId,
        details_json: JSON.stringify(e.details),
      });
    }
  });

  const connectedPremisesIds = Array.from(visited).filter((id) => id !== diseaseCase.premises_id);
  const tBfsDone = process.hrtime.bigint();
  if (process.env.DEBUG_TRACE_PERF) console.log(`[trace] BFS done in ${Number(tBfsDone - t0) / 1e6}ms`);

  // Risk scoring runs immediately after tracing (spec §5).
  const riskSummary = runRiskScoring(caseId);
  const tRiskDone = process.hrtime.bigint();
  if (process.env.DEBUG_TRACE_PERF) console.log(`[trace] risk scoring done in ${Number(tRiskDone - tBfsDone) / 1e6}ms`);

  const completedAt = new Date();
  const t1 = process.hrtime.bigint();
  const contactTraceMs = Number(t1 - t0) / 1_000_000;

  const detectionToAlertSeconds = diseaseCase.status === 'lab_confirmed'
    ? (completedAt.getTime() - new Date(diseaseCase.created_at).getTime()) / 1000
    : null;

  // Task auto-generation for newly-discovered High/Medium risk premises (spec §5).
  const tasksGenerated = generateTasksForCase(caseId);
  const tTasksDone = process.hrtime.bigint();
  if (process.env.DEBUG_TRACE_PERF) console.log(`[trace] task generation done in ${Number(tTasksDone - tRiskDone) / 1e6}ms`);

  const traceRun = TraceRunRepo.create({
    case_id: caseId,
    triggered_by: triggeredBy,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    contact_trace_ms: Math.round(contactTraceMs * 1000) / 1000,
    detection_to_alert_seconds: detectionToAlertSeconds,
    premises_found_count: connectedPremisesIds.length,
    edges_found_count: seenTriples.size,
    high_risk_count: riskSummary.high,
    medium_risk_count: riskSummary.medium,
    low_risk_count: riskSummary.low,
    tasks_generated_count: tasksGenerated.length,
  });

  AuditRepo.log(null, 'trace_run', 'disease_case', caseId, {
    connected: connectedPremisesIds.length,
    edges: seenTriples.size,
    contactTraceMs,
    tasksGenerated: tasksGenerated.length,
  });

  return {
    caseId,
    edges: allEdges.map(({ details, ...rest }) => rest),
    connectedPremisesIds,
    contactTraceMs,
    detectionToAlertSeconds,
    traceRunId: traceRun.id,
  };
}
