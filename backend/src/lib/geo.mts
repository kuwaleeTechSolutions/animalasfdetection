// =====================================================================================
// Geo utilities + repository interface.
//
// [DECIDE] Production note: in PostgreSQL+PostGIS, `withinRadiusKm` below would be a
// single `ST_DWithin(geography_col, ST_MakePoint($lng,$lat)::geography, $radius_m)`
// query executed IN the database (fast, indexed via GiST). In this SQLite pilot we
// instead pull candidate premises and compute haversine distance in application code.
// This is the ONLY place geo math lives -- swap this file's implementation for a
// PostGIS-backed one and nothing else in the codebase needs to change (GeoRepository
// interface stays identical).
// =====================================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeoRepository {
  /** Returns ids of premises within `radiusKm` of `center`, excluding `excludeId`. */
  withinRadiusKm(center: LatLng, radiusKm: number, candidates: { id: string; lat: number; lng: number }[], excludeId: string): string[];
}

// SQLite/haversine implementation (pilot). Swap for a PostGIS ST_DWithin-backed
// implementation in production -- see note above.
export const haversineGeoRepository: GeoRepository = {
  withinRadiusKm(center, radiusKm, candidates, excludeId) {
    return candidates
      .filter((c) => c.id !== excludeId && haversineKm(center, c) <= radiusKm)
      .map((c) => c.id);
  },
};
