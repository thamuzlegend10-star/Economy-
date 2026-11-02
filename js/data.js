// Static game data for the retail simulation. Pure data, no DOM.
export const SAVE_VERSION = 19;

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

// ---------- Warehouse: a separate, much bigger building with its own bulk suppliers ----------
// Goods bought here arrive in the warehouse. From there they can be sent to the shop (a transfer, which costs a trip fee) or, later, to B2B.
export const WH = { minArea: 500, maxArea: 20000, areaSteps: [500, 1000, 2500, 5000, 10000], spacePerM2: 200, rentPerM2: 1.4, minQty: 25000, maxQty: 1000000 };
export const WH_QTY = [25000, 50000, 100000, 200000, 300000, 500000, 750000, 1000000];
export const WH_BULK = [[500000, 0.20], [200000, 0.16], [100000, 0.12], [50000, 0.08], [25000, 0.04]];
export const WH_SUPPLIERS = [
  { id: "harbor", name: "Harbor Wholesale Depot", desc: "Steady bulk seller, good on time.", price: 0.85, reliability: 0.97, fee: 250, rate: 0.000025, speed: 500, prep: 0.5,
    hubs: [{ n: "Singapore", lat: 1.35, lon: 103.8 }, { n: "Jakarta", lat: -6.2, lon: 106.8 }] },
  { id: "global", name: "Global Bulk Traders", desc: "Low price, three continents.", price: 0.80, reliability: 0.93, fee: 400, rate: 0.00002, speed: 700, prep: 1,
    hubs: [{ n: "Tokyo", lat: 35.7, lon: 139.8 }, { n: "Singapore", lat: 1.35, lon: 103.8 }, { n: "New York", lat: 40.7, lon: -74 }] },
  { id: "mega", name: "MegaPack Industrial", desc: "Cheapest, but often late.", price: 0.76, reliability: 0.86, fee: 600, rate: 0.000015, speed: 900, prep: 1.2,
    hubs: [{ n: "New York", lat: 40.7, lon: -74 }, { n: "Tokyo", lat: 35.7, lon: 139.8 }] },
];
// Moving goods from the warehouse to the shop: one trip fee plus a charge per space unit. Takes one day.
export const TRANSFER = { fee: 120, rate: 0.0006, days: 1 };

// =====================================================================================
// MonsoonSIM spec, Phase 1: data for manufacturing, MRP, B2B, HR, marketing, e-commerce,
// banking, carriers and scoring. Pure data. The engine reads it from Phase 2 on.
// =====================================================================================

// ---------- Raw materials (what factories buy) ----------
// unit is how it is counted. space is storage per unit (same scale as PRODUCTS.space). cost is the base price per unit.
export const RAW = [
  { id: "appleConc",   name: "Apple concentrate",  unit: "L",      cost: 2.00,  space: 0.4,  color: "#9ad45a" },
  { id: "orangePulp",  name: "Orange pulp",        unit: "L",      cost: 1.60,  space: 0.4,  color: "#ffa94d" },
  { id: "melonSyrup",  name: "Melon syrup",        unit: "L",      cost: 2.40,  space: 0.4,  color: "#7fe0a8" },
  { id: "water",       name: "Treated water",      unit: "L",      cost: 0.002, space: 0.1,  color: "#7cc4ff" },
  { id: "bottles",     name: "Bottles (1 L)",      unit: "pcs",    cost: 0.12,  space: 0.15, color: "#b9c2d6" },
  { id: "caps",        name: "Caps and labels",    unit: "pcs",    cost: 0.05,  space: 0.02, color: "#e8e1c8" },
];

// ---------- Manufactured finished goods (juices). Each unit is one 1 L bottle. ----------
// bom: raw material units needed for one bottle. Same fields as PRODUCTS so shelves, pricing and demand can treat them alike.
export const JUICES = [
  { id: "apple",  name: "Apple juice (1 L)",  cat: "drinks", ref: 1.90, base: 800, elast: 1.9, space: 1, step: 0.05, color: "#9ad45a", note: "Steady seller",
    bom: { appleConc: 0.20, water: 0.80, bottles: 1, caps: 1 } },
  { id: "orange", name: "Orange juice (1 L)", cat: "drinks", ref: 1.90, base: 850, elast: 1.8, space: 1, step: 0.05, color: "#ffa94d", note: "Best seller",
    bom: { orangePulp: 0.25, water: 0.75, bottles: 1, caps: 1 } },
  { id: "melon",  name: "Melon juice (1 L)",  cat: "drinks", ref: 2.10, base: 450, elast: 1.6, space: 1, step: 0.05, color: "#7fe0a8", note: "Niche, better margin",
    bom: { melonSyrup: 0.15, water: 0.85, bottles: 1, caps: 1 } },
];

// ---------- Machines ----------
// perDay: bottles a machine can make per day at 100% health. life: days to depreciate to zero (straight line).
// wear: health points lost per day running. pmCost: preventive maintenance price. pmDays: downtime of a service (4 to 8 hours).
// operators: staff needed to run it. breakdownBelow: health under which a breakdown can happen. Emergency repair costs 3x pmCost and stops the line 1 to 2 days.
export const MACHINES = [
  { id: "std",  name: "Standard machine",   perDay: 1000, price: 12000, setup: 800,  life: 300, wear: 1.2, pmCost: 450,  pmDays: 0.25, operators: 1, space: 40 },
  { id: "fast", name: "High-speed machine", perDay: 3000, price: 32000, setup: 1800, life: 300, wear: 2.0, pmCost: 1100, pmDays: 0.33, operators: 2, space: 90 },
];
export const MAINT = { breakdownBelow: 30, breakdownChance: 0.25, emergencyMult: 3, downMin: 1, downMax: 2, restoreTo: 100, startHealth: 100 };

// ---------- Procurement: payment terms, requisitions ----------
// price multiplies the supplier price. days is how long the invoice stays open.
export const TERMS = [
  { id: "cod",  name: "Cash on delivery", days: 0,  price: 1.00 },
  { id: "net7",  name: "Net 7",           days: 7,  price: 1.01 },
  { id: "net14", name: "Net 14",          days: 14, price: 1.02 },
  { id: "net30", name: "Net 30",          days: 30, price: 1.035 },
];
export const PR = { approveDelayDays: 0 };   // a requisition is approved by the player, then becomes a purchase order

// Raw material vendors: same shape as SUPPLIERS but they sell RAW items, priced by RAW.cost x price.
export const RAW_VENDORS = [
  { id: "agro",   name: "AgroPulp Co.",       desc: "Fruit concentrates, fair price.",   price: 1.00, reliability: 0.94, fee: 60,  rate: 0.00003, speed: 700, prep: 0.7, sells: ["appleConc", "orangePulp", "melonSyrup", "water"],
    hubs: [{ n: "Jakarta", lat: -6.2, lon: 106.8 }, { n: "Singapore", lat: 1.35, lon: 103.8 }] },
  { id: "packco", name: "PackCo Packaging",   desc: "Bottles and caps, low minimums.",   price: 1.00, reliability: 0.97, fee: 30,  rate: 0.00002, speed: 600, prep: 0.3, sells: ["bottles", "caps"],
    hubs: [{ local: true, n: "Your district" }] },
  { id: "globalr", name: "Global Raw Supply", desc: "Everything, cheapest, often late.", price: 0.90, reliability: 0.85, fee: 220, rate: 0.000018, speed: 900, prep: 1.2, sells: ["appleConc", "orangePulp", "melonSyrup", "water", "bottles", "caps"],
    hubs: [{ n: "Tokyo", lat: 35.7, lon: 139.8 }, { n: "New York", lat: 40.7, lon: -74 }] },
];

// ---------- Warehouse overflow and internal logistics ----------
export const OVERFLOW = { perSpacePerDay: 0.02 };    // dollars per space unit above 100% capacity, per day
// Carriers for moving goods between sites. mult scales TRANSFER fee and rate. days is the lead time.
export const CARRIERS = [
  { id: "std",     name: "Standard freight", mult: 1.0, days: 2 },
  { id: "express", name: "Express",          mult: 1.8, days: 1 },
  { id: "courier", name: "Direct courier",   mult: 2.6, days: 0.5 },
];

// ---------- MRP ----------
export const MRP = { horizonDays: 7, safetyDays: 2, orderCost: 80, holdRate: 0.0008 };   // holdRate: share of unit value per day, used for EOQ

// ---------- B2B ----------
// Institutional buyers post tenders. qty is drawn from [min,max], ceiling is a multiple of the product reference price.
export const B2B = {
  buyers: [
    { id: "hotel",  name: "Grand Harbour Hotels", want: ["apple", "orange", "milk"],      qty: [4000, 20000],  ceiling: 1.05, penalty: 0.12, dueDays: [4, 8], terms: 7, risk: 0.01 },
    { id: "uni",    name: "City University",       want: ["noodles", "milk", "earbuds"],  qty: [3000, 25000],  ceiling: 0.98, penalty: 0.10, dueDays: [5, 10], terms: 14, risk: 0 },
    { id: "airline", name: "SkyLine Catering",     want: ["orange", "melon", "apple"],    qty: [6000, 30000],  ceiling: 1.10, penalty: 0.15, dueDays: [3, 7], terms: 5, risk: 0.02 },
    { id: "chain",  name: "QuickMart Chain",       want: ["noodles", "apple", "earbuds"], qty: [10000, 50000], ceiling: 0.92, penalty: 0.08, dueDays: [6, 12], terms: 21, risk: 0.03 },
  ],
  tendersPerDay: [0, 2],                    // new tenders opened each day, inclusive
  openDays: 2,                              // bidding stays open this many days
  rivals: [
    { id: "rA", name: "Northwind Supply", aggression: 0.86, reliability: 0.92 },
    { id: "rB", name: "BlueCrate Ltd.",   aggression: 0.92, reliability: 0.85 },
    { id: "rC", name: "Atlas Trading",    aggression: 0.80, reliability: 0.96 },
  ],
  // Winner score: lower price wins, reputation and reliability add weight. Weights sum to 1.
  weights: { price: 0.6, reputation: 0.25, reliability: 0.15 },
  fixedDeals: { perDay: [0, 1], discount: 0.04 },
  latePenaltyPerDay: 0.02, reputationLoss: 8, reputationGain: 3,
};

// ---------- Human capital ----------
// wage is dollars per person per day at wage multiplier 1. speed is the contribution at skill 1.
export const HR_ROLES = [
  { id: "retail",    name: "Cashiers and clerks",  wage: 38, per: "store lanes", note: "Checkout speed, customer satisfaction" },
  { id: "warehouse", name: "Warehouse handlers",   wage: 42, per: "dock",        note: "Load speed, transfer lead time" },
  { id: "factory",   name: "Machine operators",    wage: 55, per: "machine",     note: "Factory output, machine wear" },
  { id: "sales",     name: "Sales representatives", wage: 70, per: "team",       note: "B2B win rate, retention" },
  { id: "driver",    name: "Drivers",              wage: 48, per: "truck",       note: "One driver for each truck on the road" },
  { id: "service",   name: "Service staff",        wage: 45, per: "desk",        note: "Resolves support tickets" },
];
export const HR = { wageMult: { min: 0.6, max: 1.6, def: 1.0 }, trainingBudget: { min: 0, max: 2000, def: 0 },
  morale: { start: 70, min: 0, max: 100 }, turnoverBase: 0.004, skillStart: 1.0, trainingPerSkill: 400,
  recruitDays: 4, severanceDays: 5, tempPremium: 0.25, tempDays: [7, 14, 30], needPer: { warehouse: 2, sales: 2, service: 2 } };

// ---------- Marketing ----------
// reach is awareness points per 1000 dollars spent. decay is the share of awareness lost per day.
export const MKT_CHANNELS = [
  { id: "social",     name: "Social media", reach: 4.0, decay: 0.08, minBudget: 50,  note: "Cheap, short memory" },
  { id: "search",     name: "Search ads",   reach: 3.0, decay: 0.12, minBudget: 50,  note: "Good for ready-to-buy shoppers" },
  { id: "billboard",  name: "Billboards",   reach: 2.2, decay: 0.03, minBudget: 300, note: "Slow burn, long memory" },
  { id: "radio",      name: "Radio",        reach: 2.6, decay: 0.05, minBudget: 200, note: "Broad local reach" },
  { id: "influencer", name: "Influencers",  reach: 5.0, decay: 0.15, minBudget: 500, note: "Big spike, fades fast" },
];
export const MKT = { maxAwareness: 100, trafficLift: 0.35, priceSensitivityCut: 0.15, duration: { min: 1, max: 30, def: 7 } };

// ---------- E-commerce ----------
export const ECOM = { setupFee: 1500, hostingPerDay: 25, gatewayRate: 0.029, cpc: 0.35, baseConversion: 0.018, baseTraffic: 900,
  pickPackPerOrder: 0.9, parcelPerOrder: 2.6, parcelDays: 2, escrowReleaseDays: 2, catalogMax: 6 };

// ---------- Banking ----------
// Rates are per day, compounding daily.
export const BANK = {
  overdraft: { limit: 20000, rate: 0.0009 },
  credit:    { limit: 60000, rate: 0.0006, termDays: 30 },
  equipment: { rate: 0.0004, termsDays: [60, 120, 240], maxShareOfPrice: 0.8 },
  longTerm:  { rate: 0.0003, minAmount: 25000 },
};
// Income tax: every periodDays the game assesses tax on cumulative profit above what was already taxed (losses carry forward, nothing is refunded). It is paid dueDays later.
export const TAX = { rate: 0.18, periodDays: 7, dueDays: 3 };

// ---------- Service and customer satisfaction ----------
export const SRV = { neutralCsi: 80, demandPerPoint: 0.004, demandMin: 0.8, demandMax: 1.1, csiDrift: 0.15, webLateChance: 0.06, csiStart: 80, ticketRate: 0.004, perStaffPerDay: 40, lateDeliveryHit: 0.5, defectHit: 1.5, stockoutHit: 0.01, repGain: 0.02 };

// ---------- Scoring matrix: key, label, default weight. Weights are re-normalised so they sum to 1. ----------
export const KPIS = [
  { id: "netProfit",   name: "Net profit",           unit: "$", weight: 0.25 },
  { id: "revenue",     name: "Total revenue",        unit: "$", weight: 0.10 },
  { id: "roa",         name: "Return on assets",     unit: "%", weight: 0.15 },
  { id: "serviceLevel", name: "Service level",       unit: "%", weight: 0.15 },
  { id: "marketShare", name: "Market share",         unit: "%", weight: 0.10 },
  { id: "csi",         name: "Customer satisfaction", unit: "pts", weight: 0.10 },
  { id: "morale",      name: "Staff morale",         unit: "%", weight: 0.05 },
  { id: "solvency",    name: "Cash and solvency",    unit: "x", weight: 0.10 },
];

// ---------- Scenes ----------
export const SCENES = [
  { id: "store", name: "Store" }, { id: "warehouse", name: "Warehouse" }, { id: "city", name: "City" }, { id: "factory", name: "Factory" }, { id: "yard", name: "Yard" }, { id: "bank", name: "Bank" },
];

// Effect sizes of staff on the rest of the business (tunable). Everything is neutral until people are hired.
export const HR_EFFECTS = { moraleOutput: 0.15, retailBoost: 0.10, transferCut: 0.15, salesEdge: 0.06, moraleDrift: 0.1, skillMin: 0.5, skillMax: 1.6 };
// Business warning thresholds used by the warnings panel.
export const WARN = { cashLow: 3000, csiLow: 60, moraleLow: 40, healthLow: 40, storageHigh: 0.9, stockDays: 1.5 };

// Factory building: rented floor area. Machines need floor space. Rent and utilities are paid every day and become part of the cost of the goods made that day.
export const FACTORY = { minArea: 100, maxArea: 5000, areaSteps: [100, 250, 500, 1000, 2500], rentPerM2: 1.1, utilitiesPerM2: 0.12 };

// Forecasting: z is the service level multiplier for safety stock (1.65 is about 95%). window is how many days of history are used.
export const FORECAST = { window: 14, minPoints: 3, z: 1.65, minSafetyDays: 1, reviewDays: 7, errorWindow: 10, lateDayRisk: 1 };

// Company trucks. capacity is storage space per load (same scale as product space). speed is km per day. fuelPerKm is dollars per km.
// wear is health points lost per round trip. A truck under breakdownBelow can break down on departure.
export const TRUCKS = [
  { id: "van",   name: "Delivery van", capacity: 6000,  price: 14000, life: 400, speed: 700, fuelPerKm: 0.22, wear: 1.5, serviceCost: 300 },
  { id: "truck", name: "Box truck",    capacity: 30000, price: 48000, life: 500, speed: 600, fuelPerKm: 0.55, wear: 2.0, serviceCost: 900 },
];
export const TRANSPORT = { loadDays: 0.25, localKm: 15, breakdownBelow: 30, breakdownChance: 0.25, repairMult: 3, downMin: 1, downMax: 2, restoreTo: 100, tripLog: 30 };
