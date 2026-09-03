// =====================================================================================
// Risk-scoring + task-generation unit tests.
// Uses hand-crafted ContactEdge fixtures (bypassing the BFS engine) so the weighted
// threshold math itself is verified in isolation, independent of any graph cascade
// effects. Run with: node backend/tests/riskScoring.test.mts
// =====================================================================================
import { resetDb } from '../src/db/connection.mts';
resetDb();

import { PremisesRepo } from '../src/repositories/coreRepo.mts';
import { CaseRepo, ContactEdgeRepo } from '../src/repositories/caseRepo.mts';
import { UserRepo, SettingsRepo } from '../src/repositories/adminRepo.mts';
import { TaskRepo } from '../src/repositories/opsRepo.mts';
import { RiskScoreRepo } from '../src/repositories/caseRepo.mts';
import { runRiskScoring } from '../src/services/riskScoring.mts';
import { generateTasksForCase } from '../src/services/taskGeneration.mts';

SettingsRepo.ensureDefaults();

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.error(`  \u2717 FAILED: ${msg}`); }
}

console.log('=== Risk Scoring + Task Generation Unit Tests ===\n');

const officer = UserRepo.create({ name: 'Officer', email: 'o1@test.local', password: 'x', role: 'field_officer', district: 'Dibrugarh' });
const caseFarm = PremisesRepo.create({ name: 'Index', owner_name: null, owner_contact: null, village: null, block: null, district: 'Dibrugarh', lat: 27.4, lng: 95.0, premises_type: 'farm', registration_source: 'manual', external_ref_id: null, created_by: null });
const highFarm = PremisesRepo.create({ name: 'HighFarm', owner_name: null, owner_contact: null, village: null, block: null, district: 'Dibrugarh', lat: 27.41, lng: 95.01, premises_type: 'farm', registration_source: 'manual', external_ref_id: null, created_by: null });
const medFarm = PremisesRepo.create({ name: 'MedFarm', owner_name: null, owner_contact: null, village: null, block: null, district: 'Dibrugarh', lat: 27.42, lng: 95.02, premises_type: 'farm', registration_source: 'manual', external_ref_id: null, created_by: null });
const lowFarm = PremisesRepo.create({ name: 'LowFarm', owner_name: null, owner_contact: null, village: null, block: null, district: 'Dibrugarh', lat: 27.43, lng: 95.03, premises_type: 'farm', registration_source: 'manual', external_ref_id: null, created_by: null });

const diseaseCase = CaseRepo.create({ premises_id: caseFarm.id, disease: 'ASF', status: 'suspected', reported_date: new Date().toISOString(), reported_by: officer.id, lab_result_date: null, clinical_notes: null });

// HighFarm: single direct animal_movement edge at hop 1 -> weight 10 -> High (>=10)
ContactEdgeRepo.create({ case_id: diseaseCase.id, connected_premises_id: highFarm.id, pathway: 'previous_farm', hop_count: 1, via_premises_id: caseFarm.id, details_json: null });

// MedFarm: single shared-vehicle edge at hop 1 -> weight 6 -> Medium (>=5, <10)
ContactEdgeRepo.create({ case_id: diseaseCase.id, connected_premises_id: medFarm.id, pathway: 'transport_vehicle', hop_count: 1, via_premises_id: caseFarm.id, details_json: null });

// LowFarm: single nearby_farm edge at hop 1 -> weight 2 -> Low (<5)
ContactEdgeRepo.create({ case_id: diseaseCase.id, connected_premises_id: lowFarm.id, pathway: 'nearby_farm', hop_count: 1, via_premises_id: caseFarm.id, details_json: null });

const summary = runRiskScoring(diseaseCase.id);
console.log(`Risk summary: High=${summary.high} Medium=${summary.medium} Low=${summary.low}\n`);
console.log('--- Assertions ---');

const riskRows = new Map(RiskScoreRepo.byCase(diseaseCase.id).map((r) => [r.premises_id, r]));

assert(riskRows.get(highFarm.id)?.level === 'High', 'direct animal-movement contact (weight 10) scores High');
assert(riskRows.get(medFarm.id)?.level === 'Medium', 'shared-vehicle-only contact (weight 6) scores Medium');
assert(riskRows.get(lowFarm.id)?.level === 'Low', 'proximity-only contact (weight 2) scores Low');
assert(summary.high === 1 && summary.medium === 1 && summary.low === 1, 'risk summary counts match (1 High, 1 Medium, 1 Low)');

const tasks = generateTasksForCase(diseaseCase.id);
const byPremises = new Map(tasks.map((t) => [t.premises_id, t]));
assert(byPremises.has(highFarm.id), 'auto-task generated for High-risk premises');
assert(byPremises.has(medFarm.id), 'auto-task generated for Medium-risk premises');
assert(!byPremises.has(lowFarm.id), 'NO auto-task generated for Low-risk premises (flagged for manual review per spec)');
assert(byPremises.get(highFarm.id)?.task_type === 'quarantine', 'High-risk premises task_type is quarantine');
assert(byPremises.get(medFarm.id)?.task_type === 'inspect', 'Medium-risk premises task_type is inspect');
assert(byPremises.get(highFarm.id)?.priority === 'High', 'High-risk task priority field is High');
assert(byPremises.get(medFarm.id)?.priority === 'Medium', 'Medium-risk task priority field is Medium');

// Configurability check: raising the Medium threshold above 6 should flip MedFarm to Low
SettingsRepo.set('riskThresholds', { high: 10, medium: 7 });
const summary2 = runRiskScoring(diseaseCase.id);
const riskRows2 = new Map(RiskScoreRepo.byCase(diseaseCase.id).map((r) => [r.premises_id, r]));
assert(riskRows2.get(medFarm.id)?.level === 'Low', 'raising medium threshold via Settings correctly reclassifies MedFarm to Low (thresholds are configurable, not hardcoded)');
SettingsRepo.set('riskThresholds', { high: 10, medium: 5 }); // restore default

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
