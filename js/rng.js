// Small seeded random streams for the add-on modules. Each module keeps its own stream so the shop's main random stream is untouched.
export function streamNext(o) {                       // mulberry32 on o.rng
  o.rng = (o.rng + 0x6d2b79f5) | 0; let t = o.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const seedFrom = (seed, salt) => ((seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
