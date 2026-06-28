// The per-ticket "work artifact" is stored as a single marked comment on the ticket itself —
// the one anchor every tool and every backend shares. Skills find it by this sentinel and
// upsert (edit-in-place), so it is never duplicated. Read fallback chain everywhere:
//   marked comment  ->  reconstruct from ticket description + git diff (degrade, never fail).
export const ARTIFACT_SENTINEL = '<!-- ticketflow:state v1 -->';
