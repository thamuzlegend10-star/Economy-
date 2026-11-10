// Departments a game can switch off. The shop and its sales always exist. The person starting the game (the host, in a live room)
// chooses which of these are on. B2B needs something to sell to businesses, so it needs the warehouse. The factory has been retired.
export const MODS = [
  { id: "warehouse", name: "Warehouse", about: "Rent a depot, buy in bulk and send stock to the shop in batches." },
  { id: "b2b", name: "B2B", about: "Bid on tenders and sign contracts to sell large lots to other businesses." },
];
// The factory (and its juice shelf) is retired: it is always off. Its engine code stays so old saves load and the tests can still exercise it;
// the test runner sets this flag, a browser never does.
const legacy = () => globalThis.ECONOMY_LEGACY_FACTORY === true;
export const defaultMods = () => ({ warehouse: true, factory: legacy(), b2b: true });
export function cleanMods(m) {
  const o = defaultMods();
  if (m && typeof m === "object") for (const k of Object.keys(o)) if (typeof m[k] === "boolean") o[k] = m[k];
  o.factory = legacy() && !(m && m.factory === false);
  if (!o.warehouse && !o.factory) o.b2b = false;                       // nothing to sell to businesses
  return o;
}
export const modOn = (s, id) => id === "factory" ? !!(s.mods && s.mods.factory === true) : (!s.mods || s.mods[id] !== false);
export const offMsg = id => `The ${(MODS.find(m => m.id === id) || { name: id === "factory" ? "Factory" : id }).name} department is turned off in this game.`;
// Which tabs a game without some departments hides.
export const tabOff = (mods, id) => !!mods && ({ warehouse: mods.warehouse === false, factory: mods.factory === false, b2b: mods.b2b === false, shipping: mods.warehouse === false && mods.factory === false })[id] === true;
