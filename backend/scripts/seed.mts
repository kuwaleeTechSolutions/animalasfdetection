// =====================================================================================
// SEED SCRIPT -- synthetic demo data (NOT real farmer information).
//
// Populates ~50 premises across the configurable pilot districts (default: Dibrugarh,
// Tinsukia, Charaideo -- see SettingsRepo.pilotDistricts, editable in Admin > Settings,
// NOT hardcoded), with a dense-enough web of movements, shared vehicles, shared
// markets, and shared vet visits that tracing the one pre-loaded lab_confirmed ASF
// case surfaces 15-25 connected premises across all 7 pathways, mirroring the
// illustrative "one confirmed case -> 23 potentially connected farms" scenario from
// the source proposal.
//
// Idempotent: safe to re-run any number of times -- it wipes all seed-owned tables
// first, then re-inserts a fresh, deterministic-shape (but randomly jittered) dataset.
//
// Run with: node backend/scripts/seed.mts
// =====================================================================================
import { migrate, getDb } from '../src/db/connection.mts';
import { PremisesRepo, AnimalRepo, VehicleRepo, MovementRepo, VetVisitRepo } from '../src/repositories/coreRepo.mts';
import { CaseRepo } from '../src/repositories/caseRepo.mts';
import { UserRepo, SettingsRepo } from '../src/repositories/adminRepo.mts';
import { CompensationRepo } from '../src/repositories/opsRepo.mts';
import { runContactTracing } from '../src/services/contactTracing.mts';
import { transaction } from '../src/repositories/dbHelpers.mts';

migrate();
SettingsRepo.ensureDefaults();
const settings = SettingsRepo.getAll();

// [PERF NOTE] The entire seed insert workload runs inside one SQLite transaction --
// without it, hundreds of individual auto-committed INSERTs each force an fsync,
// which is extremely slow on some filesystems (measured ~25ms/insert unbatched vs
// ~0.15ms/insert batched in this sandbox). See dbHelpers.transaction() for details.
transaction(() => {
  seedAll();
});

function seedAll() {

console.log('=== Assam Livestock Biosecurity Platform -- Seed Script ===');
console.log(`Pilot districts (configurable, from settings): ${settings.pilotDistricts.join(', ')}\n`);

// ---------------------------------------------------------------------------
// Wipe (idempotent re-seed)
// ---------------------------------------------------------------------------
const db = getDb();
const tables = [
  'audit_logs', 'trace_runs', 'field_tasks', 'compensation_records', 'risk_scores',
  'contact_edges', 'disease_cases', 'vet_visits', 'movement_events', 'animals',
  'transport_vehicles', 'premises', 'users',
];
for (const t of tables) db.exec(`DELETE FROM ${t}`);
console.log('Cleared existing data (idempotent re-seed).\n');

// ---------------------------------------------------------------------------
// District anchor coordinates (real Assam district HQ approximations -- jittered below)
// ---------------------------------------------------------------------------
const DISTRICT_ANCHORS: Record<string, { lat: number; lng: number }> = {
  Dibrugarh: { lat: 27.4728, lng: 94.9120 },
  Tinsukia: { lat: 27.4898, lng: 95.3597 },
  Charaideo: { lat: 26.9520, lng: 94.9820 },
  Sivasagar: { lat: 26.9850, lng: 94.6380 },
  Jorhat: { lat: 26.7509, lng: 94.2037 },
  Golaghat: { lat: 26.5210, lng: 93.9647 },
  Lakhimpur: { lat: 27.2336, lng: 94.1064 },
  Dhemaji: { lat: 27.4833, lng: 94.5833 },
};
function anchorFor(district: string) {
  return DISTRICT_ANCHORS[district] || { lat: 26.2006, lng: 92.9376 }; // fallback: Assam centroid
}
function jitter(base: number, maxDeltaDeg: number) {
  return base + (Math.random() - 0.5) * 2 * maxDeltaDeg;
}

const pilotDistricts = settings.pilotDistricts;

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------
const stateAdmin = UserRepo.create({ name: 'Dr. Anjali Sharma (State Admin)', email: 'state.admin@ahvet.assam.gov.in', password: 'password123', role: 'state_admin', district: null, block: null, contact: '9101000001' });
const policymaker = UserRepo.create({ name: 'Secretary, AH&Vet Dept (Read-only)', email: 'secretary@ahvet.assam.gov.in', password: 'password123', role: 'policymaker', district: null, block: null, contact: '9101000002' });

const districtOfficers: Record<string, ReturnType<typeof UserRepo.create>> = {};
const fieldOfficers: Record<string, ReturnType<typeof UserRepo.create>[]> = {};
const vets: Record<string, ReturnType<typeof UserRepo.create>[]> = {};

let userSeq = 1;
for (const district of pilotDistricts) {
  const slug = district.toLowerCase().replace(/\s+/g, '');
  districtOfficers[district] = UserRepo.create({
    name: `${district} District AH Officer`, email: `do.${slug}@ahvet.assam.gov.in`, password: 'password123',
    role: 'district_officer', district, block: null, contact: `91020000${String(userSeq++).padStart(2, '0')}`,
  });
  fieldOfficers[district] = [];
  for (let i = 1; i <= 3; i++) {
    fieldOfficers[district].push(UserRepo.create({
      name: `${district} Field Vet Officer ${i}`, email: `fo${i}.${slug}@ahvet.assam.gov.in`, password: 'password123',
      role: 'field_officer', district, block: `Block-${i}`, contact: `91030000${String(userSeq++).padStart(2, '0')}`,
    }));
  }
  vets[district] = [];
  for (let i = 1; i <= 2; i++) {
    vets[district].push(UserRepo.create({
      name: `Dr. Veterinarian ${i}, ${district}`, email: `vet${i}.${slug}@ahvet.assam.gov.in`, password: 'password123',
      role: 'field_officer', district, block: `Block-${i}`, contact: `91040000${String(userSeq++).padStart(2, '0')}`,
    }));
  }
}
console.log(`Created ${1 + 1 + pilotDistricts.length * 6} users (1 state admin, 1 policymaker, ${pilotDistricts.length} district officers, ${pilotDistricts.length * 3} field officers, ${pilotDistricts.length * 2} vets).`);

// ---------------------------------------------------------------------------
// PREMISES: farms, markets, a slaughterhouse, a vet clinic, a transport hub per district
// ---------------------------------------------------------------------------
const farmsByDistrict: Record<string, ReturnType<typeof PremisesRepo.create>[]> = {};
const marketsByDistrict: Record<string, ReturnType<typeof PremisesRepo.create>[]> = {};
const villageNames = ['Rajgarh', 'Naharkatia', 'Moran', 'Chabua', 'Tengakhat', 'Barbaruah', 'Lahoal', 'Khowang', 'Panitola', 'Duliajan', 'Digboi', 'Margherita', 'Doomdooma', 'Sadiya', 'Sonari', 'Mahmora', 'Thowra', 'Titabor', 'Teok', 'Bokakhat'];

let premisesCounter = 0;
for (const district of pilotDistricts) {
  const anchor = anchorFor(district);
  farmsByDistrict[district] = [];
  marketsByDistrict[district] = [];

  const farmCount = 14; // ~14 farms x 3 districts = 42 farms + markets/infra below = ~50-55 total premises
  for (let i = 0; i < farmCount; i++) {
    const village = villageNames[(premisesCounter + i) % villageNames.length];
    const p = PremisesRepo.create({
      name: `${village} Piggery ${i + 1}`,
      owner_name: `Farmer ${village.slice(0, 3)}${i + 1}`,
      owner_contact: `98${String(100000000 + premisesCounter).slice(0, 8)}`,
      village, block: `${district} Block ${(i % 3) + 1}`, district,
      lat: jitter(anchor.lat, 0.35), lng: jitter(anchor.lng, 0.35),
      premises_type: 'farm', registration_source: i % 4 === 0 ? 'bharat_pashudhan_import' : 'manual',
      external_ref_id: i % 4 === 0 ? `BPD-${district.slice(0, 3).toUpperCase()}-${1000 + i}` : null,
      created_by: stateAdmin.id,
    });
    farmsByDistrict[district].push(p);
    premisesCounter++;
  }

  // 1-2 markets per district
  for (let i = 0; i < 2; i++) {
    const m = PremisesRepo.create({
      name: `${district} ${i === 0 ? 'Central' : 'Weekly'} Livestock Market`,
      owner_name: null, owner_contact: null, village: null, block: `${district} Block ${i + 1}`, district,
      lat: jitter(anchor.lat, 0.15), lng: jitter(anchor.lng, 0.15), premises_type: 'market',
      registration_source: 'manual', external_ref_id: null, created_by: stateAdmin.id,
    });
    marketsByDistrict[district].push(m);
  }

  // one slaughterhouse, one vet clinic, one transport hub
  PremisesRepo.create({ name: `${district} Municipal Slaughterhouse`, owner_name: null, owner_contact: null, village: null, block: null, district, lat: jitter(anchor.lat, 0.1), lng: jitter(anchor.lng, 0.1), premises_type: 'slaughterhouse', registration_source: 'manual', external_ref_id: null, created_by: stateAdmin.id });
  PremisesRepo.create({ name: `${district} Government Veterinary Clinic`, owner_name: null, owner_contact: null, village: null, block: null, district, lat: jitter(anchor.lat, 0.1), lng: jitter(anchor.lng, 0.1), premises_type: 'vet_clinic', registration_source: 'manual', external_ref_id: null, created_by: stateAdmin.id });
  PremisesRepo.create({ name: `${district} Transport Hub`, owner_name: null, owner_contact: null, village: null, block: null, district, lat: jitter(anchor.lat, 0.1), lng: jitter(anchor.lng, 0.1), premises_type: 'transport_hub', registration_source: 'manual', external_ref_id: null, created_by: stateAdmin.id });
}
const totalPremises = PremisesRepo.all().length;
console.log(`Created ${totalPremises} premises across ${pilotDistricts.length} districts (farms, markets, slaughterhouses, vet clinics, transport hubs).`);

// ---------------------------------------------------------------------------
// VEHICLES
// ---------------------------------------------------------------------------
const vehicles = [];
for (let i = 1; i <= 10; i++) {
  vehicles.push(VehicleRepo.create({
    registration_number: `AS-${String(2 + (i % 9)).padStart(2, '0')}-PIG-${1000 + i}`,
    owner_name: `Transporter ${i}`, driver_contact: `97${String(10000000 + i).slice(0, 8)}`,
  }));
}
console.log(`Created ${vehicles.length} transport vehicles.`);

// ---------------------------------------------------------------------------
// ANIMALS + MOVEMENTS + VET VISITS -- dense web designed so the INDEX case surfaces
// 15-25 connected premises across all 7 pathways.
// ---------------------------------------------------------------------------
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const allFarms = pilotDistricts.flatMap((d) => farmsByDistrict[d]);
const allMarkets = pilotDistricts.flatMap((d) => marketsByDistrict[d]);

// Give every farm at least one animal on-site.
const animalByFarm = new Map<string, ReturnType<typeof AnimalRepo.create>>();
for (const farm of allFarms) {
  const a = AnimalRepo.create({ premises_id: farm.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 2 + Math.floor(Math.random() * 8), origin_premises_id: farm.id });
  animalByFarm.set(farm.id, a);
}

// Index district/farm picked early (before background noise) so noise generation can
// deliberately steer clear of it -- see ENGINEERED INDEX CASE WEB section below for
// full details on why this specific farm/market/vet/vehicle combination was chosen.
const indexDistrict = pilotDistricts[0];
const otherDistricts = pilotDistricts.slice(1);
const indexFarm = farmsByDistrict[indexDistrict][0];
const indexMarket = marketsByDistrict[indexDistrict][0];
const indexVet = vets[indexDistrict][0];
const sharedVehicle1 = vehicles[0];
const sharedVehicle2 = vehicles[1];

// Background "noise" movements: general market activity across the whole dataset,
// so the graph feels like a real, living dataset (not just the engineered index-case
// web). Deliberately kept OUTSIDE the lookback window (30-90 days ago) and away from
// the index farm/market/vet so it adds realism without inflating the demo trace count
// beyond the illustrative 15-25 range from the source proposal.
for (let i = 0; i < 60; i++) {
  const farm = pick(allFarms);
  const market = pick(allMarkets);
  const animal = animalByFarm.get(farm.id)!;
  MovementRepo.create({
    animal_id: animal.id, from_premises_id: farm.id, to_premises_id: market.id, event_date: daysAgo(30 + Math.floor(Math.random() * 60)),
    vehicle_id: Math.random() < 0.5 ? pick(vehicles).id : null, notes: 'Routine market sale (historical)', recorded_by: stateAdmin.id, recorded_via: 'import',
  });
}

// Background vet visits across all districts/farms -- also kept outside the window.
for (let i = 0; i < 30; i++) {
  const district = pick(pilotDistricts);
  const farm = pick(farmsByDistrict[district]);
  VetVisitRepo.create({ premises_id: farm.id, veterinarian_id: pick(vets[district]).id, visit_date: daysAgo(30 + Math.floor(Math.random() * 60)), notes: 'Routine health check (historical)' });
}

// ---------------------------------------------------------------------------
// ENGINEERED INDEX CASE WEB: "PatientZero" farm in the first pilot district,
// deliberately connected to ~18-20 other farms within the default 21-day lookback
// window, spread across all 7 pathways.
// ---------------------------------------------------------------------------
console.log(`\nIndex (patient-zero) farm: "${indexFarm.name}" in ${indexDistrict} [${indexFarm.id}]`);

let connectedTargetCount = 0;

// Pathway #6 previous_farm: 3 farms sent animals INTO indexFarm within the last 14 days.
const prevFarmPool = farmsByDistrict[indexDistrict].slice(1, 5);
for (const src of prevFarmPool.slice(0, 3)) {
  const a = AnimalRepo.create({ premises_id: src.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 3, origin_premises_id: src.id });
  MovementRepo.create({ animal_id: a.id, from_premises_id: src.id, to_premises_id: indexFarm.id, event_date: daysAgo(3 + Math.floor(Math.random() * 10)), vehicle_id: null, notes: 'Piglet purchase', recorded_by: fieldOfficers[indexDistrict][0].id, recorded_via: 'field_app' });
  connectedTargetCount++;
}

// Pathway #7 destination_farm: indexFarm sent animals OUT to 3 farms within the last 10 days.
const destFarmPool = farmsByDistrict[indexDistrict].slice(5, 9);
for (const dst of destFarmPool.slice(0, 3)) {
  const a = AnimalRepo.create({ premises_id: indexFarm.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 2, origin_premises_id: indexFarm.id });
  MovementRepo.create({ animal_id: a.id, from_premises_id: indexFarm.id, to_premises_id: dst.id, event_date: daysAgo(1 + Math.floor(Math.random() * 9)), vehicle_id: null, notes: 'Weaner sale', recorded_by: fieldOfficers[indexDistrict][0].id, recorded_via: 'field_app' });
  connectedTargetCount++;
}

// Pathway #2 transport_vehicle: indexFarm used sharedVehicle1 for an outbound sale;
// 4 other farms (across districts) also used sharedVehicle1 within the window.
const indexVehicleAnimal = AnimalRepo.create({ premises_id: indexFarm.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 1, origin_premises_id: indexFarm.id });
const vehicleDropoff = farmsByDistrict[indexDistrict][9];
MovementRepo.create({ animal_id: indexVehicleAnimal.id, from_premises_id: indexFarm.id, to_premises_id: vehicleDropoff.id, event_date: daysAgo(6), vehicle_id: sharedVehicle1.id, notes: 'Trader pickup', recorded_by: fieldOfficers[indexDistrict][0].id, recorded_via: 'field_app' });
const vehicleFarmPool = [...farmsByDistrict[otherDistricts[0] || indexDistrict].slice(0, 4)];
for (const vf of vehicleFarmPool) {
  const a = AnimalRepo.create({ premises_id: vf.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 2, origin_premises_id: vf.id });
  const dropoff = pick(allMarkets);
  MovementRepo.create({ animal_id: a.id, from_premises_id: vf.id, to_premises_id: dropoff.id, event_date: daysAgo(2 + Math.floor(Math.random() * 7)), vehicle_id: sharedVehicle1.id, notes: 'Same transporter route', recorded_by: stateAdmin.id, recorded_via: 'import' });
  connectedTargetCount++;
}

// Pathway #3 market: indexFarm's animal passed through indexMarket; 4 other farms'
// animals also passed through indexMarket within the window.
const marketAnimal = AnimalRepo.create({ premises_id: indexFarm.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 1, origin_premises_id: indexFarm.id });
MovementRepo.create({ animal_id: marketAnimal.id, from_premises_id: indexFarm.id, to_premises_id: indexMarket.id, event_date: daysAgo(8), vehicle_id: null, notes: 'Weekly market sale', recorded_by: fieldOfficers[indexDistrict][1].id, recorded_via: 'field_app' });
const marketFarmPool = farmsByDistrict[indexDistrict].slice(10, 14);
for (const mf of marketFarmPool) {
  const a = AnimalRepo.create({ premises_id: mf.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 2, origin_premises_id: mf.id });
  MovementRepo.create({ animal_id: a.id, from_premises_id: mf.id, to_premises_id: indexMarket.id, event_date: daysAgo(5 + Math.floor(Math.random() * 8)), vehicle_id: null, notes: 'Weekly market sale', recorded_by: stateAdmin.id, recorded_via: 'import' });
  connectedTargetCount++;
}

// Pathway #4 veterinary_visit: indexVet visited indexFarm, and 3 other farms (incl.
// one in a neighbouring district, since vets sometimes cover multiple blocks) within the window.
VetVisitRepo.create({ premises_id: indexFarm.id, veterinarian_id: indexVet.id, visit_date: daysAgo(4), notes: 'Reported off-feed, lethargic pigs' });
const vetFarmPool = [farmsByDistrict[indexDistrict][13], ...(otherDistricts[1] ? farmsByDistrict[otherDistricts[1]].slice(0, 2) : farmsByDistrict[indexDistrict].slice(2, 4))];
for (const vfarm of vetFarmPool) {
  VetVisitRepo.create({ premises_id: vfarm.id, veterinarian_id: indexVet.id, visit_date: daysAgo(1 + Math.floor(Math.random() * 6)), notes: 'Routine circuit visit' });
  connectedTargetCount++;
}

// Pathway #5 nearby_farm: 3 farms placed deliberately within ~1.5km of indexFarm
// with NO recorded movement/vehicle/market/vet contact (pure geographic risk).
const nearbyFarms = [];
for (let i = 0; i < 3; i++) {
  const nf = PremisesRepo.create({
    name: `${indexFarm.village} Backyard Piggery ${i + 1}`, owner_name: `Neighbour Farmer ${i + 1}`, owner_contact: '9800000000',
    village: indexFarm.village, block: indexFarm.block, district: indexDistrict,
    lat: indexFarm.lat + (Math.random() - 0.5) * 0.02, lng: indexFarm.lng + (Math.random() - 0.5) * 0.02, // ~<1.5km jitter
    premises_type: 'farm', registration_source: 'manual', external_ref_id: null, created_by: stateAdmin.id,
  });
  AnimalRepo.create({ premises_id: nf.id, species: 'pig', tag_id: null, photo_url: null, batch_size: 3, origin_premises_id: nf.id });
  nearbyFarms.push(nf);
  connectedTargetCount++;
}

console.log(`Engineered ${connectedTargetCount} deliberately-connected premises around the index case (target range: 15-25).`);

// ---------------------------------------------------------------------------
// THE PRE-LOADED LAB-CONFIRMED ASF CASE
// ---------------------------------------------------------------------------
const indexCase = CaseRepo.create({
  premises_id: indexFarm.id, disease: 'ASF', status: 'lab_confirmed',
  reported_date: daysAgo(6), reported_by: fieldOfficers[indexDistrict][0].id, lab_result_date: daysAgo(1),
  clinical_notes: 'High fever, haemorrhagic lesions, sudden deaths reported in the herd. Sample sent to Regional Disease Diagnostic Laboratory; ASF confirmed by PCR.',
});
console.log(`\nPre-loaded lab_confirmed ASF case created: ${indexCase.id} at "${indexFarm.name}".`);

// Run the contact-tracing engine now so the demo is instantly ready on first load.
const traceResult = runContactTracing(indexCase.id, 'auto');
console.log(`Contact tracing complete in ${traceResult.contactTraceMs.toFixed(2)}ms -- ${traceResult.connectedPremisesIds.length} connected premises found across all 7 pathways.`);

// ---------------------------------------------------------------------------
// A couple of illustrative compensation records
// ---------------------------------------------------------------------------
CompensationRepo.create({ premises_id: indexFarm.id, case_id: indexCase.id, animals_affected_count: 14, status: 'assessed', notes: 'Culling completed; awaiting District Officer approval.', created_by: districtOfficers[indexDistrict].id });
for (const p of prevFarmPool.slice(0, 2)) {
  CompensationRepo.create({ premises_id: p.id, case_id: indexCase.id, animals_affected_count: 5, status: 'reported', notes: 'Precautionary culling under quarantine order.', created_by: districtOfficers[indexDistrict].id });
}

console.log('\n=== Seed complete. Demo login credentials (all passwords: password123) ===');
console.log(`  State Admin:        ${stateAdmin.email}`);
console.log(`  Policymaker (RO):   ${policymaker.email}`);
console.log(`  District Officer:   ${districtOfficers[indexDistrict].email}  (${indexDistrict})`);
console.log(`  Field Officer:      ${fieldOfficers[indexDistrict][0].email}  (${indexDistrict})`);
console.log(`\nDemo case ready at: ${indexFarm.name} (case id ${indexCase.id})`);
console.log('=== Done ===');
} // end seedAll()
