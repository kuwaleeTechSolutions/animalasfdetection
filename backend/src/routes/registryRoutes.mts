import { App } from '../lib/http.mts';
import { requireAuth, requireRole, blockReadOnly } from '../middleware/auth.mts';
import { PremisesRepo, AnimalRepo, VehicleRepo, MovementRepo, VetVisitRepo } from '../repositories/coreRepo.mts';
import { AuditRepo } from '../repositories/adminRepo.mts';

export function registerRegistryRoutes(app: App) {
  // ---------------------------------------------------------------------
  // PREMISES
  // ---------------------------------------------------------------------
  app.get('/api/premises', requireAuth, (req, res) => {
    const district = req.query.get('district') || undefined;
    const premises_type = req.query.get('type') || undefined;
    const q = req.query.get('q') || undefined;
    let results = PremisesRepo.list({ district, premises_type, q });
    // Field officers only see premises within their own district (RBAC scoping).
    if (req.user!.role === 'field_officer' && req.user!.district) {
      results = results.filter((p) => p.district === req.user!.district);
    }
    res.json({ count: results.length, premises: results });
  });

  app.get('/api/premises/:id', requireAuth, (req, res) => {
    const premises = PremisesRepo.getById(req.params.id);
    if (!premises) { res.status(404).json({ error: 'Premises not found' }); return; }
    res.json({ premises });
  });

  app.post('/api/premises', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.district || b.lat == null || b.lng == null || !b.premises_type) {
      res.status(400).json({ error: 'name, district, lat, lng, premises_type are required' });
      return;
    }
    const premises = PremisesRepo.create({
      name: b.name, owner_name: b.owner_name || null, owner_contact: b.owner_contact || null,
      village: b.village || null, block: b.block || null, district: b.district,
      lat: Number(b.lat), lng: Number(b.lng), premises_type: b.premises_type,
      registration_source: b.registration_source || 'manual', external_ref_id: b.external_ref_id || null,
      created_by: req.user!.id,
    });
    AuditRepo.log(req.user!.id, 'create', 'premises', premises.id, b);
    res.status(201).json({ premises });
  });

  app.put('/api/premises/:id', requireAuth, blockReadOnly, (req, res) => {
    const updated = PremisesRepo.update(req.params.id, req.body || {});
    if (!updated) { res.status(404).json({ error: 'Premises not found' }); return; }
    AuditRepo.log(req.user!.id, 'update', 'premises', updated.id, req.body);
    res.json({ premises: updated });
  });

  app.get('/api/premises/:id/animals', requireAuth, (req, res) => {
    res.json({ animals: AnimalRepo.byPremises(req.params.id) });
  });

  // ---------------------------------------------------------------------
  // ANIMALS / BATCH
  // ---------------------------------------------------------------------
  app.get('/api/animals', requireAuth, (req, res) => { res.json({ animals: AnimalRepo.all() }); });

  app.post('/api/animals', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.premises_id || !b.species) { res.status(400).json({ error: 'premises_id and species are required' }); return; }
    const animal = AnimalRepo.create({
      premises_id: b.premises_id, species: b.species, tag_id: b.tag_id || null, photo_url: b.photo_url || null,
      batch_size: Number(b.batch_size) || 1, origin_premises_id: b.origin_premises_id || b.premises_id,
    });
    AuditRepo.log(req.user!.id, 'create', 'animal', animal.id, b);
    res.status(201).json({ animal });
  });

  // ---------------------------------------------------------------------
  // TRANSPORT VEHICLES
  // ---------------------------------------------------------------------
  app.get('/api/vehicles', requireAuth, (req, res) => { res.json({ vehicles: VehicleRepo.all() }); });

  app.post('/api/vehicles', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.registration_number) { res.status(400).json({ error: 'registration_number is required' }); return; }
    const vehicle = VehicleRepo.findOrCreateByRegNumber(b.registration_number, b.owner_name, b.driver_contact);
    AuditRepo.log(req.user!.id, 'create', 'transport_vehicle', vehicle.id, b);
    res.status(201).json({ vehicle });
  });

  // ---------------------------------------------------------------------
  // MOVEMENT EVENTS
  // ---------------------------------------------------------------------
  app.get('/api/movements', requireAuth, (req, res) => { res.json({ movements: MovementRepo.all() }); });

  app.post('/api/movements', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.animal_id || !b.from_premises_id || !b.to_premises_id || !b.event_date) {
      res.status(400).json({ error: 'animal_id, from_premises_id, to_premises_id, event_date are required' });
      return;
    }
    let vehicleId: string | null = b.vehicle_id || null;
    if (!vehicleId && b.vehicle_registration_number) {
      vehicleId = VehicleRepo.findOrCreateByRegNumber(b.vehicle_registration_number, b.vehicle_owner_name, b.vehicle_driver_contact).id;
    }
    const movement = MovementRepo.create({
      animal_id: b.animal_id, from_premises_id: b.from_premises_id, to_premises_id: b.to_premises_id,
      event_date: b.event_date, vehicle_id: vehicleId, notes: b.notes || null,
      recorded_by: req.user!.id, recorded_via: b.recorded_via || 'field_app',
    });
    AuditRepo.log(req.user!.id, 'create', 'movement_event', movement.id, b);
    res.status(201).json({ movement });
  });

  // ---------------------------------------------------------------------
  // VET VISITS
  // ---------------------------------------------------------------------
  app.get('/api/vet-visits', requireAuth, (req, res) => { res.json({ visits: VetVisitRepo.all() }); });

  app.post('/api/vet-visits', requireAuth, blockReadOnly, (req, res) => {
    const b = req.body || {};
    if (!b.premises_id || !b.visit_date) { res.status(400).json({ error: 'premises_id and visit_date are required' }); return; }
    const visit = VetVisitRepo.create({
      premises_id: b.premises_id, veterinarian_id: b.veterinarian_id || req.user!.id, visit_date: b.visit_date, notes: b.notes || null,
    });
    AuditRepo.log(req.user!.id, 'create', 'vet_visit', visit.id, b);
    res.status(201).json({ visit });
  });

  // ---------------------------------------------------------------------
  // [INTEGRATION POINT: Bharat Pashudhan / INAPH import]
  // CSV-upload stub for the pilot. Expected columns:
  // name,owner_name,owner_contact,village,block,district,lat,lng,premises_type,external_ref_id
  // In production this endpoint would instead call the Bharat Pashudhan / INAPH REST
  // API on a schedule (or via webhook) and upsert premises by external_ref_id.
  // ---------------------------------------------------------------------
  app.post('/api/import/premises-csv', requireAuth, requireRole('state_admin', 'district_officer'), (req, res) => {
    const { csv, source } = req.body || {};
    if (!csv) { res.status(400).json({ error: 'csv (raw text) is required' }); return; }
    const lines = String(csv).trim().split('\n');
    const header = lines[0].split(',').map((h: string) => h.trim());
    const created = [];
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols = line.split(',').map((c: string) => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h: string, i: number) => { row[h] = cols[i]; });
      const premises = PremisesRepo.create({
        name: row.name, owner_name: row.owner_name || null, owner_contact: row.owner_contact || null,
        village: row.village || null, block: row.block || null, district: row.district,
        lat: Number(row.lat), lng: Number(row.lng), premises_type: (row.premises_type as any) || 'farm',
        registration_source: source === 'inaph' ? 'inaph_import' : 'bharat_pashudhan_import',
        external_ref_id: row.external_ref_id || null, created_by: req.user!.id,
      });
      created.push(premises);
    }
    AuditRepo.log(req.user!.id, 'import', 'premises', null, { count: created.length, source });
    res.status(201).json({ importedCount: created.length, premises: created });
  });
}
