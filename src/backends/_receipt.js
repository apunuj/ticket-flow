// Write-receipt clause appended to every mutating backend op. Backend writes are the
// workflow's durable trail — a silently failed (or silently skipped) write is how a run
// ends with code on a branch and nothing on the ticket. The clause makes the agent
// confirm the write landed and surface failures instead of drifting into fallbacks.
export const RECEIPT =
  ' — then **verify the write**: the response must contain the created/updated id; report it (with the ticket URL) in your summary. If the call fails or the tool is unavailable, stop and tell the user — never continue silently';
