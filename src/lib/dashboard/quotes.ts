export type DashboardQuote = { text: string; author: string };

/**
 * Short, attributed lines for the teacher dashboard. The page is
 * force-dynamic, so picking one on the server per request never mismatches
 * on hydration.
 */
export const DASHBOARD_QUOTES: readonly DashboardQuote[] = [
  { text: "A good teacher can inspire hope, ignite the imagination, and instill a love of learning.", author: "Brad Henry" },
  { text: "Once you learn to read, you will be forever free.", author: "Frederick Douglass" },
  { text: "The more that you read, the more things you will know.", author: "Dr. Seuss" },
  { text: "Education is not preparation for life; education is life itself.", author: "John Dewey" },
  { text: "It is easier to build strong children than to repair broken men.", author: "Frederick Douglass" },
  { text: "Children are the living messages we send to a time we will not see.", author: "Neil Postman" },
  { text: "Every child deserves a champion.", author: "Rita Pierson" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King" },
  { text: "Small progress each day leads to big results.", author: "Unknown" },
  { text: "Reading is to the mind what exercise is to the body.", author: "Joseph Addison" },
];

export function pickQuote(random: () => number = Math.random): DashboardQuote {
  const i = Math.min(
    Math.floor(random() * DASHBOARD_QUOTES.length),
    DASHBOARD_QUOTES.length - 1
  );
  return DASHBOARD_QUOTES[i];
}
