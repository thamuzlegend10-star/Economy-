import * as D from "../js/data.js"; import * as E from "../js/engine.js";
const s = E.newGame({ mode:"standard", difficulty:"normal", dayLimit:12, seed:7919 });
let n=0;
while(!s.ended && n++<300000){
  if(s.phase==="report"){ const r=s.lastReport; console.log(`D${r.day} rev ${r.revenue.toFixed(0)} net ${r.net.toFixed(0)} cust ${r.customers} served ${r.served} lostStock ${r.lost.stockout} lostPat ${r.lost.patience} lostPrice ${r.lost.price} wait ${r.avgWait} sat ${r.sat} rep ${r.rep} liquid ${r.closeLiquid.toFixed(0)}`); E.nextDay(s); continue; }
  if(s.clock===0){
    const lines=[]; for(const p of D.PRODUCTS){ if(!E.isUnlocked(s,p.id))continue; const have=E.unitsTotal(s,p.id)+E.incomingOf(s,p.id); if(have<20) lines.push({pid:p.id,qty:40-have}); }
    if(lines.length){ const r=E.placeOrder(s,{supplier:"metro",lines,pay:"bank"}); if(!r.ok) console.log("order fail",r.error); }
    for(const p of D.PRODUCTS) E.setShelfTarget(s,p.id,14);
  }
  E.tick(s,0.5);
}
