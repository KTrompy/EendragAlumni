// "Ghost" accounts: browse-only and invisible to every other member.
// Introduced in schema-update-58.sql, which is where the real enforcement
// lives — the profiles SELECT policy withholds a ghost's row from everyone
// but themselves and admins, and a restrictive RLS policy plus a BEFORE
// trigger on every member-writable table refuse their writes.
//
// Nothing in this file is a security boundary. It exists so a ghost isn't
// shown controls that would fail if they pressed them.

export function isGhost(profile) {
  return profile?.is_ghost === true
}

// The one predicate the write-affordance checks across the app should use.
//
// Every component that gates a create/post/apply control was already asking
// `profile?.approved` and nothing else, six times over in five files. Ghost
// mode adds a second condition to exactly that same question, so it goes in
// one place rather than being remembered at six call sites — and at whatever
// the seventh turns out to be.
export function canWrite(profile) {
  return profile?.approved === true && profile?.is_ghost !== true
}
