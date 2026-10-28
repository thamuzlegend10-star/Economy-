// Location catalog. Pure data + lookups, no DOM. Every number here is a GAME-BALANCING COEFFICIENT chosen for play,
// not a statistic: 1.0 means "same as the neutral start". Districts are SIMULATED sites; the country, region and city
// names and the coordinates are real places, but nothing about the districts is verified real-world data.
//
// Fields: demand (customer volume), rent / wage / utilities (cost multipliers), logistics (supplier fee and delivery time),
// power (purchasing power: how far above the fair price shoppers still buy), priceSens (reaction to price),
// competition (0..1, share of demand lost to rivals), cat (demand by product category), noSupplier (suppliers that do not serve it).
export const NEUTRAL = {
  id: "default", name: "Generic district", country: "Anywhere", region: "-", city: "-", district: "Neutral start", lat: 0, lon: 0, tz: "UTC", currency: "USD", simulated: true,
  character: "balanced", popClass: "medium", demand: 1, rent: 1, wage: 1, utilities: 1, logistics: 1, power: 1, priceSens: 1, competition: 0,
  cat: { food: 1, drinks: 1, household: 1, stationery: 1, electronics: 1 }, noSupplier: [],
  provenance: "Neutral reference: the rules the game was balanced on. No real-world data.",
};

const L = (o) => ({ ...NEUTRAL, simulated: true, provenance: "Coefficients are game-balancing estimates. District is simulated. Not sourced statistics.", ...o, cat: { ...NEUTRAL.cat, ...(o.cat || {}) } });

export const LOCATIONS = [
  NEUTRAL,
  L({ id: "id-medan-central", name: "Medan, central market area", country: "Indonesia", region: "North Sumatra", city: "Medan", district: "Central market area", lat: 3.59, lon: 98.67, tz: "Asia/Jakarta", currency: "IDR",
    character: "dense commercial", popClass: "large city", demand: 1.25, rent: 0.8, wage: 0.55, utilities: 0.85, logistics: 1.0, power: 0.9, priceSens: 1.15, competition: 0.35, cat: { food: 1.25, drinks: 1.15, household: 1.0, stationery: 0.9, electronics: 0.85 } }),
  L({ id: "id-medan-residential", name: "Medan, residential suburb", country: "Indonesia", region: "North Sumatra", city: "Medan", district: "Residential suburb", lat: 3.55, lon: 98.64, tz: "Asia/Jakarta", currency: "IDR",
    character: "residential", popClass: "large city", demand: 0.85, rent: 0.55, wage: 0.55, utilities: 0.8, logistics: 1.1, power: 0.9, priceSens: 1.2, competition: 0.15, cat: { food: 1.2, drinks: 1.0, household: 1.2, stationery: 1.1, electronics: 0.7 } }),
  L({ id: "id-siantar-town", name: "Pematangsiantar, town centre", country: "Indonesia", region: "North Sumatra", city: "Pematangsiantar", district: "Town centre", lat: 2.96, lon: 99.06, tz: "Asia/Jakarta", currency: "IDR",
    character: "small town", popClass: "small city", demand: 0.55, rent: 0.4, wage: 0.45, utilities: 0.75, logistics: 1.35, power: 0.8, priceSens: 1.3, competition: 0.1, noSupplier: ["quickship"], cat: { food: 1.2, household: 1.1, electronics: 0.6 } }),
  L({ id: "id-jakarta-central", name: "Central Jakarta, business district", country: "Indonesia", region: "Jakarta", city: "Central Jakarta", district: "Business district", lat: -6.18, lon: 106.83, tz: "Asia/Jakarta", currency: "IDR",
    character: "dense commercial", popClass: "metropolis", demand: 1.6, rent: 1.7, wage: 0.8, utilities: 1.1, logistics: 0.9, power: 1.15, priceSens: 0.95, competition: 0.55, cat: { food: 1.1, drinks: 1.2, stationery: 1.15, electronics: 1.3 } }),
  L({ id: "id-denpasar-tourist", name: "Denpasar, tourist street", country: "Indonesia", region: "Bali", city: "Denpasar", district: "Tourist street", lat: -8.65, lon: 115.22, tz: "Asia/Makassar", currency: "IDR",
    character: "tourist", popClass: "medium city", demand: 1.2, rent: 1.1, wage: 0.6, utilities: 0.95, logistics: 1.2, power: 1.2, priceSens: 0.8, competition: 0.45, cat: { food: 1.1, drinks: 1.5, household: 0.7, stationery: 0.7, electronics: 1.0 } }),
  L({ id: "sg-central", name: "Singapore, central region", country: "Singapore", region: "Central Region", city: "Singapore", district: "Central region", lat: 1.3, lon: 103.85, tz: "Asia/Singapore", currency: "SGD",
    character: "dense commercial", popClass: "metropolis", demand: 1.4, rent: 2.2, wage: 1.7, utilities: 1.3, logistics: 0.8, power: 1.5, priceSens: 0.8, competition: 0.6, cat: { drinks: 1.2, electronics: 1.4 } }),
  L({ id: "my-kl-centre", name: "Kuala Lumpur, city centre", country: "Malaysia", region: "Federal Territory", city: "Kuala Lumpur", district: "City centre", lat: 3.14, lon: 101.69, tz: "Asia/Kuala_Lumpur", currency: "MYR",
    character: "dense commercial", popClass: "metropolis", demand: 1.3, rent: 1.2, wage: 0.85, utilities: 0.95, logistics: 0.95, power: 1.05, priceSens: 1.0, competition: 0.5, cat: { food: 1.1, electronics: 1.15 } }),
  L({ id: "jp-tokyo-central", name: "Tokyo, central ward", country: "Japan", region: "Kanto", city: "Tokyo", district: "Central ward", lat: 35.68, lon: 139.76, tz: "Asia/Tokyo", currency: "JPY",
    character: "dense commercial", popClass: "metropolis", demand: 1.5, rent: 2.4, wage: 1.8, utilities: 1.4, logistics: 0.85, power: 1.5, priceSens: 0.85, competition: 0.65, cat: { food: 1.15, stationery: 1.3, electronics: 1.4 } }),
  L({ id: "us-nyc-manhattan", name: "New York City, Manhattan", country: "United States", region: "New York", city: "New York City", district: "Manhattan", lat: 40.75, lon: -73.98, tz: "America/New_York", currency: "USD",
    character: "dense commercial", popClass: "metropolis", demand: 1.55, rent: 3.0, wage: 2.2, utilities: 1.5, logistics: 0.9, power: 1.6, priceSens: 0.85, competition: 0.7, cat: { food: 1.1, drinks: 1.2, electronics: 1.2 } }),
];

const BY_ID = Object.fromEntries(LOCATIONS.map(l => [l.id, l]));
export const getLocation = id => BY_ID[id] || NEUTRAL;
export const hasLocation = id => Object.prototype.hasOwnProperty.call(BY_ID, id);
export const playableLocations = () => LOCATIONS.filter(l => l.id !== "default");
export const countries = () => [...new Set(playableLocations().map(l => l.country))];
export const search = q => {
  const t = String(q || "").trim().toLowerCase(); if (!t) return playableLocations();
  return playableLocations().filter(l => [l.name, l.country, l.region, l.city, l.district].some(x => x.toLowerCase().includes(t)));
};
