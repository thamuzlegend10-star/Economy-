// Teaching scenarios: a fixed setup, scripted shocks on set days (no random events), goals checked at the end, and a lesson.
// Pure data. The engine applies it; nothing here touches the DOM or the network.
export const SHOCK_KINDS = ["rain", "festival", "delay", "market", "repair", "rivalpromo"];
export const SHOCK_LABEL = { rain: "Heavy rain", festival: "Local festival", delay: "Supplier delay", market: "Market price rise", repair: "Equipment repair", rivalpromo: "Rival promotion" };

export const SCENARIOS = [
  { id: "supply-crunch", name: "Supply crunch", level: "Intermediate", scripted: true,
    brief: "Your main wholesaler hits road trouble and water gets expensive. Can you keep the shelves full without wrecking your cash?",
    lesson: "Spread orders across suppliers, keep a safety stock before a known delay, and watch the cost of a fast supplier against empty shelves.",
    setup: { difficulty: "normal", capital: 1200, days: 12, location: "id-medan-central" },
    shocks: [{ day: 3, kind: "delay", sup: "metro", days: 4 }, { day: 4, kind: "market", pid: "water", days: 4 }, { day: 8, kind: "rain" }],
    goals: [{ kind: "netWorthGain", min: 0.15, text: "Grow net worth by 15%" }, { kind: "service", min: 0.85, text: "Serve 85% of wanted items (few empty shelves)" }, { kind: "noOverdraft", text: "Finish with no overdraft or overdue invoice" }] },
  { id: "price-war", name: "Price war", level: "Intermediate", scripted: true,
    brief: "A busy district with several rivals who run promotions. Hold your share without giving away your margin.",
    lesson: "Share follows price, reputation and availability. A rival promotion is short; chasing it with a deep cut costs more than waiting it out.",
    setup: { difficulty: "normal", capital: 1500, days: 12, location: "id-jakarta-central" },
    shocks: [{ day: 3, kind: "rivalpromo" }, { day: 6, kind: "rivalpromo" }, { day: 9, kind: "rivalpromo" }],
    goals: [{ kind: "netWorthGain", min: 0.15, text: "Grow net worth by 15%" }, { kind: "share", min: 0.3, text: "End with at least 30% local market share" }, { kind: "rep", min: 55, text: "Reputation 55 or more" }] },
  { id: "cash-squeeze", name: "Cash squeeze", level: "Hard", scripted: true,
    brief: "Thin capital, repair bills and a supplier delay. Survive without borrowing yourself into a hole.",
    lesson: "Cash and profit are not the same thing. Supplier terms and a small buffer smooth shocks; heavy borrowing and idle stock do not.",
    setup: { difficulty: "hard", capital: 600, days: 14, location: "default" },
    shocks: [{ day: 3, kind: "repair", amount: 60 }, { day: 5, kind: "rain" }, { day: 6, kind: "delay", sup: "metro", days: 3 }, { day: 10, kind: "repair", amount: 70 }],
    goals: [{ kind: "noOverdraft", text: "Finish with no overdraft or overdue invoice" }, { kind: "netWorthGain", min: 0.1, text: "Grow net worth by 10% despite the shocks" }, { kind: "rep", min: 50, text: "Reputation 50 or more" }] },
  { id: "grand-opening", name: "Grand opening", level: "Beginner", scripted: true,
    brief: "A friendly start with two festivals. Prepare stock, staff the counter and make the most of the crowds.",
    lesson: "A busy day only pays if shelves are full and checkout keeps up. Use the forecast and campaigns before the crowd arrives.",
    setup: { difficulty: "easy", capital: 1500, days: 10, location: "default" },
    shocks: [{ day: 3, kind: "festival" }, { day: 8, kind: "festival" }],
    goals: [{ kind: "customers", min: 300, text: "Serve 300 customers in total" }, { kind: "rep", min: 65, text: "Reputation 65 or more" }, { kind: "netWorthGain", min: 0.25, text: "Grow net worth by 25%" }] },
];
export const getScenario = id => SCENARIOS.find(x => x.id === id) || null;
export const hasScenario = id => !!getScenario(id);
