# Eendrag Alumni — Feature & UI Audit
**Date:** 2026-08-01

Full pass through every frontend feature (`src/components/*`, helpers) plus a Supabase advisor check, looking for concrete failure modes — not style nitpicks. Findings are grounded in specific code, cited by file.

---

## 1. Real bugs — leftover dead-feature references

The Groups/Photos/Merchandise rip-outs were clean (no dangling UI). The Mentoring rip-out was clean too. But the Jobs feature has real leftover breakage from the "apply through platform" migration:

- **`Jobs.jsx` silently deletes legacy apply data on edit.** `JobForm` state still tracks `apply_method`/`apply_url`/`contact_email`/`additional_email` (restored from the record on edit, persisted in localStorage drafts), but the actual insert/update payload hardcodes all three fields to `''` regardless of the form state. Editing and re-saving any older job listing that had an external apply link/email quietly wipes it — `shareJob()`'s "Apply: {url}" line then disappears too.
- **`JobModal.jsx` is dead code.** Not imported anywhere; `JobDetail.jsx`'s own comment confirms it replaced this component. It still references the old `apply_url`/`onApplyEmail`/`contact_email` flow. Safe to delete.
- **`ics.js` is fully built but never wired up.** `buildIcs`/`downloadIcs`/`icsFilenameFor` (RFC 5545 folding, escaping, UTF-8 handling — all correct) are exported but never imported. There's no "Add to calendar" button anywhere in `Events.jsx`. This isn't a bug so much as a shipped feature nobody can reach.
- **`BusinessDirectory.jsx` map clustering key is broken.** Line ~241: `` `${city}|${country}` || `${lat},${lng}` `` — a template literal is always truthy, even when both fields are empty (`"|"`), so the coordinate fallback never runs. Every business missing city/country data collapses into one shared cluster pin at an averaged centroid. `AlumniMap.jsx`'s equivalent function does this correctly with an explicit `if/return` — worth copying that pattern over.
- Two stale doc-comments (`PersonProfile.jsx:41`, `BusinessDescriptionEditor.jsx:6,11`) still say "Groups" describing where a component is used from — comments only, no functional impact.

## 2. Closed/expired jobs can still be applied to

`Jobs.jsx`'s card list hides the Apply button once `isJobClosed(j)` is true, but `JobDetail.jsx`'s Apply button only checks `!isMine` / `hasApplied` — no closed/expired check. Anyone who reaches a closed job via a saved link, share, or bookmark can still submit an application. `ApplyModal.jsx` has no gate of its own either; it trusts the caller. Fix belongs in `JobDetail.jsx`.

## 3. Auth & signup

- **Untrimmed email breaks sign-in silently.** `validateSignin()` checks `email.trim()`, but the actual `signInWithPassword`/`resetPasswordForEmail` calls use the raw untrimmed value. A pasted email with trailing whitespace passes validation, then fails with a generic "invalid credentials" message that reads as a wrong password.
- **Password-recovery screen has no exit.** In `App.jsx`, `recoveryMode` is checked before the "no session" check, so if a recovery link expires mid-flow, `ResetPassword.jsx` keeps rendering against a dead session with no cancel/back-to-sign-in button — the only way out is a manual refresh. `recoveryMode` is also never cleared on `SIGNED_OUT`.
- **`ResetPassword.jsx` has no `<form>` element.** Inputs sit in bare `<label>`s and the submit button uses `onClick`, not `onSubmit` — pressing Enter after typing both password fields does nothing, unlike every other auth screen in the app.
- **Signup retry silently fails under CAPTCHA.** After `signUp()`, if no session comes back, the code retries `signInWithPassword` without a `captchaToken`. If CAPTCHA is enforced on sign-in too, this internal retry fails for a reason the user is never told about, and they land in the generic "couldn't sign you in" branch.
- **No handling of OAuth cancel/deny.** Supabase appends `?error=access_denied` to the redirect URL when a user cancels a Google/social consent screen; nothing in `App.jsx` reads it, so a cancelled login just drops the user back at sign-in with zero feedback.
- **`FinishSignup.jsx` has no draft persistence.** A 10+ field form with no autosave — refreshing or navigating back mid-fill loses everything typed, with only "Sign out" as an escape hatch.
- **`PendingVerification.jsx` signs a user out with no explanation** if their profile row was deleted by an admin — looks like a random bug rather than an account removal.
- Minor: 8 spaces passes as a valid password (length check doesn't reject whitespace-only strings); the support email is hardcoded into the shipped bundle.

*(Password-change flow in `Settings.jsx` is unusually well-hardened — no issues found there.)*

## 4. Home dashboard, Feed, Messaging, Search

- **Home dashboard error states are silent.** The batch `Promise.all` of widget queries never checks `error` on the destructured results — a failed query (RLS hiccup, network blip) just renders an empty widget with no retry or error UI. Same failure class as the auth-race bug that was fixed earlier, just triggered by real query errors instead of timing, and the existing auth-race retry only fires once before giving up permanently.
- **Stale search results (race condition), in two places.** Both `Feed.jsx` and `GlobalSearch.jsx` debounce the *timer* but not the *request* — a slow-resolving earlier keystroke's response can land after a faster later one and overwrite it with stale results. No abort controller or generation token guards either.
- **Feed: scrolling far away destroys open state.** `LazyPost`'s IntersectionObserver fully unmounts a post once it's 1600px+ out of view — an open comment thread or in-progress comment draft silently disappears if the user scrolls past that point.
- **Messages: reactions don't load on "Load older messages."** `loadOlder()` never fetches reactions for the newly-loaded page, so older messages never show their reactions.
- **Messages: no per-thread live unread updates.** A message arriving in a thread you don't have open never updates that thread's preview or order in the list — only the floating aggregate badge reflects it, and even that misses brand-new conversations created after the subscription was set up (`FloatingMessages.jsx`).
- **Messages: no reconnect gap-fill.** If the websocket drops, anything sent during the outage (messages, reactions, read receipts) is never backfilled on reconnect — only live events are handled.
- **NotificationBell has the exact race it was written to avoid.** `persistRead()` explicitly calls `getSession()` first to guard the known auth-not-settled bug (per code comments), but `load()` right above it doesn't — the initial notification list is exposed to the same race. Unread count is also capped by a `.limit(30)` fetch, so 30+ unread notifications undercounts the badge.
- **WhosOnline: track-after-unmount race.** Fast navigation between Home/Feed (both mount this component) can let a pending `channel.track()` callback fire after `removeChannel()` already ran during cleanup.

## 5. Events, Directory, Mentoring, Maps

- **Event capacity isn't reconciled on edit.** `EventFormEnhanced.jsx` lets an admin lower `max_registrations` below the current RSVP count with no validation or warning — the event ends up "over capacity" with no flag anywhere.
- **`DirectoryFilters.jsx` allows inverted year ranges** (`yearFrom > yearTo`) with no validation — silently returns zero results and no explanation to the user.
- Geocoding/maps are otherwise solid: missing Mapbox token degrades gracefully, failed geocodes aren't cached (so they get retried), and coordinate order is explicitly handled — the clustering bug above (#1) is the one real defect.

## 6. Admin panel & shared UI

- **Admin destructive actions have no double-submit lock**, though the practical exploit window is small (single synchronous tick). No busy-state indicator on approve/promote/delete buttons either, so rapid clicking is possible even if mostly harmless.
- **Moderation "mark reviewed/dismiss" fails silently.** `ReportsModeration.setStatus` reloads the list on failure with no error toast — a failed action looks like it worked until the item visibly reappears.
- **File upload type validation is missing in two places.** `Profile.jsx`'s `pickPhoto` and `pickCv` only check file *size*, never *type* (the `accept` attribute is a UI hint only, not enforcement). A non-image file under the size limit reaches `PhotoCropper`, whose `<img onLoad>` never fires — the user is stuck in a dead modal with Save permanently disabled and no error message.
- **No keyboard navigation in any autocomplete component** (City/Country/List/MultiSelect) — type-only, no arrow-key highlighting or Enter-to-select-highlighted-item. `DropdownPortal` and `DateTimePicker` also have no Escape-to-close handler (click-outside only).
- **`CityAutocomplete` has a stale-response race** on its Mapbox lookup (no abort/request-id guard) and swallows network failures silently — no suggestions, no visible error.
- Sanitization (`sanitizeHtml.js`), rich text paste handling, and link href validation were all checked directly for XSS gaps — none found. `ErrorBoundary`, `ConfirmDialog`, and `ProfileModal` are solid.

## 7. Supabase advisor findings (live check, 2026-08-01)

**Security:**
- 12 `SECURITY DEFINER` functions are callable by any authenticated user (`admin_delete_member`, `admin_list_members`, `delete_message`, `edit_message`, `get_or_create_conversation`, `get_profile_contact`, `is_admin`, `is_approved`, `is_participant`, `last_messages_for_conversations`, `mark_conversation_read`, `unread_message_count`). This is very likely intentional — these are exactly the RPCs the app is designed to call from the client — but each one is only as safe as its internal `WHERE`/role checks, since `SECURITY DEFINER` bypasses RLS entirely inside the function body. Worth a quick pass to confirm every one of these checks caller identity/ownership internally, especially `admin_delete_member` given how destructive it is.
- **Leaked password protection is disabled** (HaveIBeenPwned check) — a one-click toggle in the Auth dashboard, still open from the prior auth-hardening pass.

**Performance (all low-severity):**
- `profiles` table has two overlapping permissive UPDATE policies ("Admins can update any profile" + "Users can update own profile") — both run on every update; consolidating into one policy with an OR condition would be marginally faster.
- Two duplicate index pairs exist and can be dropped: `businesses_owner_id_idx`/`businesses_owner_idx`, and `conv_participants_user_id_idx`/`conversation_participants_user_id_idx`.
- ~20 indexes across posts/messages/jobs/events/notifications/reports have never been used — likely just low traffic so far rather than a real problem, but worth revisiting if the dataset grows.

---

## Priority if you want to fix things in order

1. Jobs.jsx apply-field wipe on edit (silent data loss, currently live)
2. JobDetail.jsx missing closed-job gate (lets people apply to dead listings)
3. BusinessDirectory.jsx clustering bug (merges unrelated map pins)
4. ResetPassword dead-end / no form submit on Enter (real user-facing dead end)
5. Home dashboard swallowing query errors + NotificationBell auth race (same root cause pattern flagged twice now — worth a systematic fix rather than one-off patches)
6. File upload type validation (Profile photo/CV) — dead-modal trap
7. Everything else in this doc — smaller UX rough edges and defense-in-depth cleanup, not urgent
