// The Mail inbox. Every message is created by a real event in the simulation (a late delivery, a breakdown, a tax bill, a contract, a scenario event).
const MAX = 60;
export const newMail = () => ({ seq: 0, items: [] });
export const ensureMail = s => (s.mail = s.mail || newMail());
// goto: [main tab, sub tab] makes the message link to where you can act on it.
export function mailPost(s, { from, subject, body, goto = null, level = "info" }) {
  const m = ensureMail(s); m.items.push({ id: ++m.seq, day: s.day, from, subject, body, goto, level, read: false });
  if (m.items.length > MAX) m.items.splice(0, m.items.length - MAX);
}
export const unread = s => ensureMail(s).items.filter(x => !x.read).length;
export function markRead(s, id) { for (const x of ensureMail(s).items) if (id === "all" || x.id === Number(id)) x.read = true; return { ok: true }; }
export function clearMail(s) { ensureMail(s).items = []; return { ok: true }; }
