// Calendar dates as 'YYYY-MM-DD' (DATEONLY columns). Arithmetic is done in UTC, so a date never
// shifts with the server's time zone.

export const todayISO = (now = new Date()) => now.toISOString().slice(0, 10);

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// True for a real calendar date such as '2026-02-28' (not '2026-02-30').
export function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
