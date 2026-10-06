// Display helpers shared by the portals.

export function money(amount, currency = 'KES') {
  if (amount === 0) return 'Unpaid';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export const date = (value) => (value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
export const dateTime = (value) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

// "in 3 days", "today", "closed"
export function deadlineText(deadline, now = Date.now()) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return 'Closed';
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  return `Closes in ${days} days`;
}

export function fileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// "shortlisted" -> "Shortlisted"
export const statusLabel = (status) => {
  const text = String(status ?? '').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
