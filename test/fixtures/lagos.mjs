// @ts-check
// Real-ish Lagos coordinates for tests (OpenStreetMap, rounded). Not used at runtime.

export const AREAS = {
  yaba: { label: "Yaba", lat: 6.5095, lon: 3.3711 },
  lekki: { label: "Lekki Phase 1", lat: 6.4474, lon: 3.4723 },
  ikeja: { label: "Ikeja", lat: 6.6018, lon: 3.3515 },
  surulere: { label: "Surulere", lat: 6.5, lon: 3.35 },
  ikoyi: { label: "Ikoyi", lat: 6.452, lon: 3.435 },
  vi: { label: "Victoria Island", lat: 6.4281, lon: 3.4219 },
  ajah: { label: "Ajah", lat: 6.4672, lon: 3.57 },
  apapa: { label: "Apapa", lat: 6.4489, lon: 3.359 },
  ikorodu: { label: "Ikorodu", lat: 6.6194, lon: 3.5105 },
  lagosIsland: { label: "Lagos Island", lat: 6.455, lon: 3.388 },
};

/** Candidate places in the shape the Overpass adapter returns. */
export const PLACES = {
  jakande: { name: "Johnson Jakande Tinubu Park", lat: 6.6012, lon: 3.3546, osm: { type: "way", id: 1001, tags: { leisure: "park", name: "Johnson Jakande Tinubu Park" } } },
  freedom: { name: "Freedom Park", lat: 6.4497, lon: 3.3972, osm: { type: "way", id: 1002, tags: { leisure: "park", name: "Freedom Park", fee: "yes" } } },
  muri: { name: "Muri Okunola Park", lat: 6.4339, lon: 3.4231, osm: { type: "way", id: 1003, tags: { leisure: "park", name: "Muri Okunola Park" } } },
  elegushi: { name: "Elegushi Beach", lat: 6.4246, lon: 3.5056, osm: { type: "way", id: 1004, tags: { natural: "beach", name: "Elegushi Beach", fee: "yes" } } },
  ikoyiGarden: { name: "Ikoyi Garden", lat: 6.4541, lon: 3.4302, osm: { type: "node", id: 1005, tags: { leisure: "garden", name: "Ikoyi Garden", fee: "no" } } },
  yabaBar: { name: "Yaba Lounge", lat: 6.5101, lon: 3.3779, osm: { type: "node", id: 1006, tags: { amenity: "bar", name: "Yaba Lounge" } } },
};
