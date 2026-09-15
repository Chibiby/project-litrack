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

export function pickQuote(random: () => number = Math.random): DashboardQuote {
  const i = Math.min(
    Math.floor(random() * DASHBOARD_QUOTES.length),
    DASHBOARD_QUOTES.length - 1
  );
  return DASHBOARD_QUOTES[i];
}
