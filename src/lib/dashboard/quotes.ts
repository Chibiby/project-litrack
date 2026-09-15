export type DashboardQuote = { text: string; author: string };

/**
 * Short, warm, encouraging lines for the teacher dashboard — nothing grim or
 * preachy; a teacher should feel cheered on when they open it. The page is
 * force-dynamic, so picking one on the server per request never mismatches
 * on hydration.
 */
export const DASHBOARD_QUOTES: readonly DashboardQuote[] = [
  { text: "A good teacher can inspire hope, ignite the imagination, and instill a love of learning.", author: "Brad Henry" },
  { text: "The more that you read, the more things you will know.", author: "Dr. Seuss" },
  { text: "Every child deserves a champion.", author: "Rita Pierson" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King" },
  { text: "Small progress each day leads to big results.", author: "Unknown" },
  { text: "It takes a big heart to help shape little minds.", author: "Unknown" },
  { text: "Today a reader, tomorrow a leader.", author: "Margaret Fuller" },
  { text: "Teaching is the one profession that creates all other professions.", author: "Unknown" },
  { text: "Every page a child reads opens a new door.", author: "Unknown" },
  { text: "You are planting seeds that will grow for a lifetime.", author: "Unknown" },
];

/** Warm lines about learners, for the v2 Learners page banner. */
export const LEARNER_QUOTES: readonly DashboardQuote[] = [
  { text: "A good teacher sees potential in every learner.", author: "Unknown" },
  { text: "Every learner can grow; some just need a little more time.", author: "Unknown" },
  { text: "Children learn more from what you are than what you teach.", author: "W.E.B. Du Bois" },
  { text: "Every child is a different kind of flower, and all together make this world a beautiful garden.", author: "Unknown" },
  { text: "Believe in every learner, and watch them believe in themselves.", author: "Unknown" },
  { text: "The best way to learn is with a friendly guide beside you.", author: "Unknown" },
  { text: "Reading is a gift that opens every door.", author: "Unknown" },
  { text: "Each learner's small step today is a big story tomorrow.", author: "Unknown" },
];

export function pickQuote(
  random: () => number = Math.random,
  quotes: readonly DashboardQuote[] = DASHBOARD_QUOTES
): DashboardQuote {
  const i = Math.min(Math.floor(random() * quotes.length), quotes.length - 1);
  return quotes[i];
}
