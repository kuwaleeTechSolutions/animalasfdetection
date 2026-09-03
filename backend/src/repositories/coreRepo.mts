import { run, get, all, nowIso } from './dbHelpers.mts';
import { newId } from '../lib/ids.mts';

// ---------------------------------------------------------------------------
// PREMISES
// ---------------------------------------------------------------------------
export interface Premises {
  id: string;
  name: string;
  owner_name: string | null;
  owner_contact: string | null;
  village: string | null;
  block: string | null;
  district: string;
  lat: number;
  lng: number;
  premises_type: 'farm' | 'market' | 'slaughterhouse' | 'vet_clinic' | 'transport_hub';
  registration_source: 'manual' | 'bharat_pashudhan_import' | 'inaph_import';
  external_ref_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PremisesRepo = {
  create(data: Omit<Premises, 'id' | 'created_at' | 'updated_at'>): Premises {
    const id = newId('prem');
    const ts = nowIso();
    run(
      `INSERT INTO premises (id,name,owner_name,owner_contact,village,block,district,lat,lng,premises_type,registration_source,external_ref_id,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.name, data.owner_name, data.owner_contact, data.village, data.block, data.district, data.lat, data.lng,
        data.premises_type, data.registration_source, data.external_ref_id, data.created_by, ts, ts]
    );
    return this.getById(id)!;
  },
  getById(id: string): Premises | undefined {
    return get<Premises>('SELECT * FROM premises WHERE id = ?', [id]);
  },
  list(filters: { district?: string; premises_type?: string; q?: string } = {}): Premises[] {
    let sql = 'SELECT * FROM premises WHERE 1=1';
    const params: any[] = [];
    if (filters.district) { sql += ' AND district = ?'; params.push(filters.district); }
    if (filters.premises_type) { sql += ' AND premises_type = ?'; params.push(filters.premises_type); }
    if (filters.q) { sql += ' AND (name LIKE ? OR owner_name LIKE ? OR village LIKE ?)'; params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`); }
    sql += ' ORDER BY created_at DESC';
    return all<Premises>(sql, params);
  },
  all(): Premises[] { return all<Premises>('SELECT * FROM premises'); },
  update(id: string, patch: Partial<Premises>): Premises | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updated_at: nowIso() };
    run(
      `UPDATE premises SET name=?,owner_name=?,owner_contact=?,village=?,block=?,district=?,lat=?,lng=?,premises_type=?,registration_source=?,external_ref_id=?,updated_at=? WHERE id=?`,
      [merged.name, merged.owner_name, merged.owner_contact, merged.village, merged.block, merged.district, merged.lat, merged.lng,
        merged.premises_type, merged.registration_source, merged.external_ref_id, merged.updated_at, id]
    );
    return this.getById(id);
  },
};

// ---------------------------------------------------------------------------
// ANIMALS
// ---------------------------------------------------------------------------
export interface Animal {
  id: string;
  premises_id: string;
  species: 'pig' | 'cattle' | 'goat' | 'poultry' | 'other';
  tag_id: string | null;
  photo_url: string | null;
  batch_size: number;
  origin_premises_id: string | null;
  created_at: string;
}

export const AnimalRepo = {
  create(data: Omit<Animal, 'id' | 'created_at'>): Animal {
    const id = newId('anml');
    const ts = nowIso();
    run(
      `INSERT INTO animals (id,premises_id,species,tag_id,photo_url,batch_size,origin_premises_id,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [id, data.premises_id, data.species, data.tag_id, data.photo_url, data.batch_size, data.origin_premises_id, ts]
    );
    return this.getById(id)!;
  },
  getById(id: string): Animal | undefined { return get<Animal>('SELECT * FROM animals WHERE id = ?', [id]); },
  byPremises(premisesId: string): Animal[] { return all<Animal>('SELECT * FROM animals WHERE premises_id = ?', [premisesId]); },
  all(): Animal[] { return all<Animal>('SELECT * FROM animals'); },
};

// ---------------------------------------------------------------------------
// TRANSPORT VEHICLES
// ---------------------------------------------------------------------------
export interface TransportVehicle {
  id: string;
  registration_number: string;
  owner_name: string | null;
  driver_contact: string | null;
  created_at: string;
}

export const VehicleRepo = {
  create(data: Omit<TransportVehicle, 'id' | 'created_at'>): TransportVehicle {
    const id = newId('veh');
    const ts = nowIso();
    run(`INSERT INTO transport_vehicles (id,registration_number,owner_name,driver_contact,created_at) VALUES (?,?,?,?,?)`,
      [id, data.registration_number, data.owner_name, data.driver_contact, ts]);
    return this.getById(id)!;
  },
  getById(id: string): TransportVehicle | undefined { return get<TransportVehicle>('SELECT * FROM transport_vehicles WHERE id = ?', [id]); },
  findOrCreateByRegNumber(regNumber: string, ownerName?: string, driverContact?: string): TransportVehicle {
    const existing = get<TransportVehicle>('SELECT * FROM transport_vehicles WHERE registration_number = ?', [regNumber]);
    if (existing) return existing;
    return this.create({ registration_number: regNumber, owner_name: ownerName || null, driver_contact: driverContact || null });
  },
  all(): TransportVehicle[] { return all<TransportVehicle>('SELECT * FROM transport_vehicles'); },
};

// ---------------------------------------------------------------------------
// MOVEMENT EVENTS
// ---------------------------------------------------------------------------
export interface MovementEvent {
  id: string;
  animal_id: string;
  from_premises_id: string;
  to_premises_id: string;
  event_date: string;
  vehicle_id: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_via: 'field_app' | 'import';
  created_at: string;
}

export const MovementRepo = {
  create(data: Omit<MovementEvent, 'id' | 'created_at'>): MovementEvent {
    const id = newId('mv');
    const ts = nowIso();
    run(
      `INSERT INTO movement_events (id,animal_id,from_premises_id,to_premises_id,event_date,vehicle_id,notes,recorded_by,recorded_via,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, data.animal_id, data.from_premises_id, data.to_premises_id, data.event_date, data.vehicle_id, data.notes, data.recorded_by, data.recorded_via, ts]
    );
    // Keep the animal's current location in sync with its latest movement.
    run('UPDATE animals SET premises_id = ? WHERE id = ?', [data.to_premises_id, data.animal_id]);
    return this.getById(id)!;
  },
  getById(id: string): MovementEvent | undefined { return get<MovementEvent>('SELECT * FROM movement_events WHERE id = ?', [id]); },
  all(): MovementEvent[] { return all<MovementEvent>('SELECT * FROM movement_events'); },
  touchingPremises(premisesId: string): MovementEvent[] {
    return all<MovementEvent>('SELECT * FROM movement_events WHERE from_premises_id = ? OR to_premises_id = ?', [premisesId, premisesId]);
  },
  byVehicle(vehicleId: string): MovementEvent[] {
    return all<MovementEvent>('SELECT * FROM movement_events WHERE vehicle_id = ?', [vehicleId]);
  },
};

// ---------------------------------------------------------------------------
// VET VISITS
// ---------------------------------------------------------------------------
export interface VetVisit {
  id: string;
  premises_id: string;
  veterinarian_id: string;
  visit_date: string;
  notes: string | null;
  created_at: string;
}

export const VetVisitRepo = {
  create(data: Omit<VetVisit, 'id' | 'created_at'>): VetVisit {
    const id = newId('vv');
    const ts = nowIso();
    run(`INSERT INTO vet_visits (id,premises_id,veterinarian_id,visit_date,notes,created_at) VALUES (?,?,?,?,?,?)`,
      [id, data.premises_id, data.veterinarian_id, data.visit_date, data.notes, ts]);
    return this.getById(id)!;
  },
  getById(id: string): VetVisit | undefined { return get<VetVisit>('SELECT * FROM vet_visits WHERE id = ?', [id]); },
  all(): VetVisit[] { return all<VetVisit>('SELECT * FROM vet_visits'); },
  byPremises(premisesId: string): VetVisit[] { return all<VetVisit>('SELECT * FROM vet_visits WHERE premises_id = ?', [premisesId]); },
  byVet(vetId: string): VetVisit[] { return all<VetVisit>('SELECT * FROM vet_visits WHERE veterinarian_id = ?', [vetId]); },
};
