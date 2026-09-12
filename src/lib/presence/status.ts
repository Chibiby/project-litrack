const ONLINE_WINDOW_MS = 3 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type PresenceStatus = {
  online: boolean;
  label: string;
};

/** Derive the deliberately modest active-app presence language used by support. */
export function getPresenceStatus(
  lastOnlineAt: Date | null,
  now: Date = new Date()
): PresenceStatus {
  const then = lastOnlineAt?.getTime();
  const current = now.getTime();
  if (!lastOnlineAt || then === undefined || !Number.isFinite(then) || !Number.isFinite(current)) {
    return { online: false, label: "Last online unavailable" };
  }

  const ageMs = Math.max(0, current - then);
  if (ageMs <= ONLINE_WINDOW_MS) return { online: true, label: "Online" };

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return { online: false, label: `Last online ${minutes}m ago` };

  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 24) return { online: false, label: `Last online ${hours}h ago` };

  const days = Math.floor(ageMs / DAY_MS);
  if (days < 7) return { online: false, label: `Last online ${days}d ago` };

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(lastOnlineAt);
  return { online: false, label: `Last online ${date}` };
}
