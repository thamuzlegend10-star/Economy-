// Static game data for the retail simulation. Pure data, no DOM.
export const SAVE_VERSION = 11;

// Three products. Space is how much storage one unit takes. elast is how strongly demand reacts to the selling price.
// base is the daily demand at the reference price in a neutral district.
export const PRODUCTS = [
  { id: "noodles", name: "Instant noodles", cat: "food",        cost: 0.85, ref: 1.40,  base: 2000, elast: 2.2, space: 1,   step: 0.05, color: "#d9a05b", note: "High volume, thin margin" },
  { id: "milk",    name: "Fresh milk",      cat: "drinks",      cost: 1.95, ref: 2.80,  base: 1000, elast: 1.7, space: 2,   step: 0.10, color: "#4aa8ff", note: "Bulky, steady demand" },
  { id: "earbuds", name: "Earbuds",         cat: "electronics", cost: 6.00, ref: 11.50, base: 160,  elast: 1.4, space: 0.5, step: 0.25, color: "#ff8a8a", note: "Few sales, big margin" },
];

// Suppliers. price multiplies the base cost. hubs are places goods ship from (the nearest hub counts).
// A hub with local:true is always 30 km away. speed is km per day. rate is shipping cost per space-unit per km.
export const SUPPLIERS = [
  { id: "metro",   name: "Metro Wholesale",   desc: "Fair price, three hubs.",           price: 1.00, reliability: 0.95, fee: 40, rate: 0.00004, speed: 900, prep: 0.5,
    hubs: [{ n: "Jakarta", lat: -6.2, lon: 106.8 }, { n: "Tokyo", lat: 35.7, lon: 139.8 }, { n: "New York", lat: 40.7, lon: -74 }] },
  { id: "pacific", name: "Pacific Trade Co.", desc: "Cheapest, but less reliable.",      price: 0.93, reliability: 0.88, fee: 60, rate: 0.00003, speed: 800, prep: 0.8,
    hubs: [{ n: "Singapore", lat: 1.35, lon: 103.8 }, { n: "Kuala Lumpur", lat: 3.14, lon: 101.7 }, { n: "Tokyo", lat: 35.7, lon: 139.8 }] },
  { id: "local",   name: "Local Co-op",       desc: "Next door. Dearer, but next door.",   price: 1.12, reliability: 0.98, fee: 15, rate: 0.00002, speed: 600, prep: 0.2,
    hubs: [{ local: true, n: "Your district" }] },
];

export const QTY_CHOICES = [1000, 3000, 5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 125000, 150000];
export const MAX_QTY = 150000;
export const BULK = [[125000, 0.13], [75000, 0.10], [30000, 0.06], [10000, 0.03]];   // [min units, discount]

export const SPACE_PER_M2 = 100;          // storage units per rented square metre
export const RENT_PER_M2 = 4.0;           // dollars per m2 per day in a neutral district (district rent factor multiplies it)
export const AREA = { min: 20, max: 2000, def: 250 };
export const SECONDS_PER_DAY = { min: 10, max: 120, def: 30 };
export const DAYS = { min: 5, max: 60, def: 30 };
export const CAPITAL = { min: 10000, max: 200000, def: 40000 };
export const START_STOCK = { noodles: 3000, milk: 1200, earbuds: 120 };

// Extra space the player can rent later, in m2. Rent and traffic follow the new total area.
export const SPACE_STEPS = [10, 25, 50, 100, 250, 500];
