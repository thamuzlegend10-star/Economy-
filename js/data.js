// Static game data. Everything tunable lives here.
export const SAVE_VERSION = 7;
export const DAY_LEN = 120;          // sim-seconds per business day (at 1x speed)
export const OPEN_HOUR = 8, CLOSE_HOUR = 20;

export const CATEGORIES = {
  food:       { name: "Food",       color: "#d9a05b" },
  drinks:     { name: "Drinks",     color: "#4aa8ff" },
  household:  { name: "Household",  color: "#8ee0a8" },
  stationery: { name: "Stationery", color: "#c79bff" },
  electronics:{ name: "Electronics",color: "#ff8a8a" },
};

// cost = wholesale base (before supplier multiplier); ref = fair market price customers expect
export const PRODUCTS = [
  { id:"apple",   name:"Apple",         cat:"food",        cost:1.0, ref:2.5,  pop:1.3, unlockDay:1 },
  { id:"bread",   name:"Bread",         cat:"food",        cost:1.8, ref:4.0,  pop:1.2, unlockDay:1 },
  { id:"milk",    name:"Milk",          cat:"drinks",      cost:3.0, ref:6.5,  pop:1.0, unlockDay:1 },
  { id:"water",   name:"Water",         cat:"drinks",      cost:0.6, ref:1.5,  pop:1.4, unlockDay:1 },
  { id:"juice",   name:"Orange Juice",  cat:"drinks",      cost:2.2, ref:4.5,  pop:0.9, unlockDay:3 },
  { id:"rice",    name:"Rice 1kg",      cat:"food",        cost:6.0, ref:11.0, pop:0.7, unlockDay:3 },
  { id:"noodles", name:"Noodles",       cat:"food",        cost:0.8, ref:1.8,  pop:1.1, unlockDay:5 },
  { id:"soap",    name:"Soap",          cat:"household",   cost:1.5, ref:3.5,  pop:0.7, unlockDay:5 },
  { id:"tissue",  name:"Tissue Pack",   cat:"household",   cost:1.2, ref:2.8,  pop:0.8, unlockDay:7 },
  { id:"notebook",name:"Notebook",      cat:"stationery",  cost:1.4, ref:3.2,  pop:0.6, unlockDay:8 },
  { id:"battery", name:"Batteries x4",  cat:"electronics", cost:2.5, ref:5.5,  pop:0.5, unlockDay:10 },
  { id:"earbuds", name:"Earbuds",       cat:"electronics", cost:8.0, ref:17.0, pop:0.35,unlockDay:12 },
];

export const SUPPLIERS = [
  { id:"freshfarm", name:"FreshFarm Co-op",   desc:"Cheapest for food and drinks. Slow trucks.",
    cats:["food","drinks"], mult:0.92, terms:{ days:5, markup:0.02 }, lead:30, fee:6,  reliability:0.97, minUnits:10, bulkAt:50,  bulkOff:0.05 },
  { id:"metro",     name:"Metro Wholesale",   desc:"Full catalog. Fair price, normal speed.",
    cats:["food","drinks","household","stationery","electronics"], mult:1.0, terms:{ days:7, markup:0.03 }, lead:20, fee:10, reliability:0.94, minUnits:1, bulkAt:100, bulkOff:0.08 },
  { id:"quickship", name:"QuickShip Express", desc:"Everything in 5 seconds. Premium price and fee.",
    cats:["food","drinks","household","stationery","electronics"], mult:1.18, lead:5, fee:18, reliability:0.99, minUnits:1, bulkAt:9999, bulkOff:0 },
];

export const ROLES = {
  cashier:   { name:"Cashier",          base:14, desc:"Faster checkout, shorter queues." },
  stocker:   { name:"Shelf stocker",    base:12, desc:"Moves goods from warehouse to shelves faster." },
  warehouse: { name:"Warehouse worker", base:13, desc:"Unloads trucks faster." },
  manager:   { name:"Store manager",    base:24, desc:"Customers rate every visit about 5 points higher, which slowly lifts satisfaction and reputation." },
};
export const MAX_STAFF = 8;
const FIRST = ["Aira","Budi","Citra","Dewi","Eko","Fajar","Gita","Hadi","Indah","Joko","Kirana","Lukas","Maya","Naufal","Olla","Putra","Qori","Rani","Sinta","Tomo"];
export const NAMES = FIRST;

export const UPGRADES = [
  { id:"shelves", name:"Shelf rows",      max:3, costs:[250,400,650],  effect:"+40 shelf capacity per level",        cosmetic:false },
  { id:"racks",   name:"Warehouse racks", max:3, costs:[300,500,800],  effect:"+150 warehouse capacity per level",   cosmetic:false },
  { id:"counter", name:"Checkout counter",max:2, costs:[350,600],      effect:"+1 checkout lane per level",          cosmetic:false },
  { id:"dock",    name:"Loading bay",     max:1, costs:[450],          effect:"Trucks unload 50% faster",            cosmetic:false },
  { id:"signage", name:"Shop signage",    max:2, costs:[200,500],      effect:"Cosmetic: lit sign and storefront",   cosmetic:true  },
];
export const BASE_SHELF_CAP = 60, SHELF_PER_LVL = 40;
export const BASE_WH_CAP = 200, WH_PER_LVL = 150;

export const LOANS = [
  { id:"small",  name:"Small Business Loan", principal:1000, dailyRate:0.004, days:10, feePct:0.02, minDay:1,  minNetWorth:0    },
  { id:"expand", name:"Expansion Loan",      principal:3000, dailyRate:0.005, days:20, feePct:0.02, minDay:5,  minNetWorth:1200 },
  { id:"equip",  name:"Equipment Loan",      principal:8000, dailyRate:0.007, days:30, feePct:0.025,minDay:10, minNetWorth:3500 },
];
export const OVERDRAFT_RATE = 0.01;   // per day on overdraft
export const RESCUE_RATE = 0.008;

export const DIFFICULTY = {
  easy:   { name:"Easy",   capital:1500, demand:1.15, cost:0.92, events:0.5, rent:30, utilities:8,  reliability:+0.03 },
  normal: { name:"Normal", capital:1000, demand:1.00, cost:1.00, events:1.0, rent:40, utilities:10, reliability:0 },
  hard:   { name:"Hard",   capital:700,  demand:0.88, cost:1.12, events:1.6, rent:55, utilities:14, reliability:-0.04 },
};

export const EVENTS = [
  { id:"festival", name:"Local festival",   text:"A street festival brings +40% customers today.", demand:1.4 },
  { id:"rain",     name:"Heavy rain",       text:"Rain keeps people at home: -25% customers today.", demand:0.75 },
  { id:"delay",    name:"Supplier delay",   text:"One supplier has road trouble: new orders from them take 60% longer to arrive for 2 days." },
  { id:"market",   name:"Market price rise",text:"Wholesale cost of one product is +25% for 3 days." },
  { id:"repair",   name:"Equipment repair", text:"A fridge broke. Repair bill is charged at closing." },
];

export const MILESTONES = [
  { id:"first_sale",  name:"First sale",         test:s => s.stats.totalSales > 0 },
  { id:"hundred",     name:"100 customers served",test:s => s.stats.customers >= 100 },
  { id:"nw_2000",     name:"Net worth $2,000",   test:s => s.derived?.netWorth >= 2000 },
  { id:"nw_10000",    name:"Net worth $10,000",  test:s => s.derived?.netWorth >= 10000 },
  { id:"first_upg",   name:"First upgrade",      test:s => Object.values(s.upgrades).some(v => v > 0) },
  { id:"staff3",      name:"Team of three",      test:s => s.staff.length >= 3 },
  { id:"debt_free",   name:"Debt-free after a loan", test:s => s.stats.tookLoan && s.derived && s.derived.debt === 0 },
  { id:"unlock_all",  name:"Every product unlocked", test:s => s.day >= 12 },
];

// Marketing campaigns: paid up front, start after a delay, run for a fixed number of days. `lift` is the extra share of
// customers while running. Reach is shown to the player as a range so the choice is a real trade-off.
export const CAMPAIGNS = [
  { id: "flyers", name: "Flyers", cost: 40, delay: 0, days: 2, lift: 0.12, desc: "Cheap and quick. Hand out leaflets in the neighborhood." },
  { id: "radio", name: "Local radio", cost: 110, delay: 1, days: 3, lift: 0.22, desc: "Starts tomorrow, runs three days." },
  { id: "social", name: "Social ads", cost: 240, delay: 2, days: 5, lift: 0.30, desc: "Takes two days to ramp up, then runs five days." },
];
export const MAX_CAMPAIGNS = 3;
// Supplier price index: a bounded daily random walk around 1.00. Buy when it is low, wait when it is high.
export const SUP_DRIFT = { step: 0.025, min: 0.88, max: 1.18 };
