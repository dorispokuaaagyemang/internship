// US-12: suspensions and deletions need a reason, which the server keeps in the audit log.
// Returns the reason, or null when the admin cancels or gives too little.
export function askReason(question) {
  const answer = window.prompt(`${question}\n\nReason (kept in the audit log):`);
  if (answer === null) return null;
  const reason = answer.trim();
  if (reason.length < 3) {
    window.alert('Please give a reason of at least a few words.');
    return null;
  }
  return reason;
}
