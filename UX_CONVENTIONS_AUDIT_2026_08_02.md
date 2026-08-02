# UX conventions audit — 2026-08-02

Scope: places where the app behaves differently from what a user would expect
from an industry-standard web app. Not a security or bug audit — these are
"I clicked that and it did the wrong thing" issues.

---

## High — real data loss or surprising destruction

### 1. Backdrop click discards a half-written post/job/business with no warning
- `Feed.jsx:749` — composer overlay: `onClick` → `closeModal()`
- `Jobs.jsx:1021` — create panel: `onClick` → `handleCancel()`
- `BusinessDirectory.jsx:795` — create panel: same
- `EventFormEnhanced.jsx` — same pattern

You can type a 400-word post, mis-click 2px outside the box, and everything is
gone. LinkedIn, X, Notion, Gmail all either (a) ignore backdrop clicks once the
form is dirty, or (b) confirm ("Discard post?"), or (c) save a draft.

The app already has the machinery for this — `Profile.jsx` tracks `dirty` and
`App.jsx:280` wires a `beforeunload` guard. None of the composers use it.

**Fix:** track dirty state in each composer; if dirty, backdrop click opens a
`ConfirmDialog` instead of closing.

### 2. Same composers can't be closed with Escape
`Feed.jsx`, `Jobs.jsx` and `BusinessDirectory.jsx` do handle Escape — but only
for the mobile **filter drawer** (`Jobs.jsx:240`, `BusinessDirectory.jsx:193`).
The create panels themselves have no Escape handler. So the biggest modals in
the app are the only ones that ignore the universal "close modal" key, while
small ones (ConfirmDialog, ApplyModal, GlobalSearch) honour it.

---

## Medium — inconsistent with the rest of the app or the web

### 3. "Share" on a job copies a text blob, not a link
`Jobs.jsx:261` and `JobDetail.jsx:116` build a plain-text summary
(`Title @ Company / type · location / Apply: … / (via the Eendrag Alumni job
board)`) and copy that.

`/jobs/:jobId` is a real route (`App.jsx:795`). Events do it correctly —
`Events.jsx:661` copies `${origin}/events/${id}`. A button labelled "Share"
that puts prose on the clipboard instead of a URL is the odd one out, and it's
inconsistent with the Share button two tabs over.

**Fix:** copy the URL (optionally URL + summary), matching Events.

### 4. Cards navigate but aren't links — no ⌘-click, no middle-click, no "open in new tab"
Person cards (`Directory.jsx:151`), job cards (`Jobs.jsx:535`), business cards
(`BusinessDirectory.jsx:527`), mentor cards (`Mentoring.jsx:155`) and the Home
widgets (`Home.jsx:517`, `:640`, `:696`) are `<div role="button">` calling
`navigate()`.

Consequences, all of which people hit in a directory-style app:
- ⌘/Ctrl+click and middle-click do nothing instead of opening a new tab
- no URL preview in the status bar on hover
- "Open link in new tab" is missing from the right-click menu
- screen readers announce "button" for something that is a link

**Fix:** wrap the card in `<a href="/people/:id">` (or a router `<Link>`) and
let `onClick` be the enhancement, not the whole mechanism. This is how
LinkedIn/Indeed/GitHub all build result cards.

### 5. `role="button"` cards that only respond to Enter, not Space
ARIA's button pattern requires both keys. Handled correctly in
`Directory.jsx:134`, `Jobs.jsx:538`, `BusinessDirectory.jsx:530`; missing Space in:
- `Mentoring.jsx:155`
- `Home.jsx:519`
- `Home.jsx:643`
- `Home.jsx:696` (no `onKeyDown` at all — focusable via `tabIndex={0}` but
  can't be activated by keyboard)

### 6. Interactive controls nested inside a `role="button"` card
`Directory.jsx:174` puts a Message button and a LinkedIn link inside the card,
which is itself `role="button"`. Nesting interactive content inside a button is
invalid; it works only because of the `stopPropagation()` calls. Assistive tech
flattens it into one confusing control.

Solved automatically by fix #4 (card becomes a link with a stretched-link
overlay, actions sit above it).

### 7. Most modals don't trap or restore focus
Only `ProfileModal.jsx:56-80` implements a focus trap and focus restore.
Every other modal — `ConfirmDialog`, `ApplyModal`, `GlobalSearch`,
`ReportButton`, `WhosOnline`, `PhotoCropper`, the Home badges modal, the Profile
picture modal, and all the composers — lets Tab walk straight into the page
behind, and drops focus to `<body>` on close.

**Fix:** extract `ProfileModal`'s trap into a `useFocusTrap()` hook and apply it
to every `modal-backdrop`.

### 8. Five modals ignore Escape
`Home.jsx:719` (badges), `WhosOnline.jsx:103`, `ReportButton.jsx:89`,
`PhotoCropper.jsx:214`, `Profile.jsx:1354` (avatar). All are closable by
backdrop click, so Escape is the only missing half of the pair.

### 9. Image lightbox is not keyboard-operable and has no close button
`Feed.jsx:471` — the lightbox closes only on backdrop click. No Escape, no ×
button, and the image itself has no `alt`. The thumbnail that opens it
(`Feed.jsx:1046`) is a bare `<img onClick>` — not focusable, no `role`, no
cursor affordance.

---

## Low — polish, but noticeable

### 10. Only 5 `<form>` elements in the whole app
`Auth.jsx` (×2), `FinishSignup.jsx`, `ResetPassword.jsx`. Everything else —
posting a job, creating an event, adding a business, the apply modal, the report
modal, the profile editor, the settings password change — is labels + inputs +
an `onClick` button.

That means in those forms: **Enter doesn't submit**, browsers can't offer native
validation or autofill grouping, and password managers get weaker signals.
Pressing Enter in a text field doing nothing is the single most common
"why isn't this working" complaint for hand-rolled forms.

### 11. 321 `<button>` elements with no `type` attribute
Harmless today because they're mostly outside forms, but the HTML default is
`type="submit"`. The moment any of them is moved inside a `<form>` (see #10) it
silently starts submitting it. Cheap to fix globally with an ESLint rule
(`react/button-has-type`).

### 12. Error toasts auto-dismiss in 3.2s
`Toast.jsx:22`. Fine for "Post published"; too fast for an error the user needs
to read and act on. Convention (and WCAG 2.2.1) is that error messages persist
until dismissed. Also, the toast is a `<button>` you dismiss by clicking, with
no × to indicate that's possible.

### 13. Comment box: Enter sends, with no composition guard
`Feed.jsx:1207`, `Events.jsx:942` — `onKeyDown={(e) => e.key === 'Enter' && send()}`.
It's an `<input>`, so no newline is lost, and `Messages.jsx:925` gets it exactly
right (Enter sends, Shift+Enter newlines). The gap is `e.nativeEvent.isComposing` —
with an IME active, Enter-to-confirm-a-candidate will send the half-typed comment.
Also `Messages.jsx:826` (edit a message) fires on Enter without the `isComposing`
or `shiftKey` check the main composer has.

### 14. `disabled` buttons with no explanation
87 `disabled={...}` bindings; `Directory.jsx:178` and a handful of others set a
`title`, most don't. A greyed-out button with no tooltip and no inline reason is
a dead end — the user can't tell whether it's broken or gated.

### 15. Modals are not in browser history
No modal pushes a history entry, so on mobile the hardware/gesture Back button
navigates away from the page instead of closing the open sheet — the single most
common mobile complaint about SPA modals.

---

## What's already right

Worth noting so it doesn't get "fixed":

- `DeleteButton.jsx` — every destructive action routes through `ConfirmDialog`,
  with a trash icon that reads as destructive. No `window.confirm` anywhere.
- Body scroll lock is applied consistently, including the mobile-Safari
  `position: fixed` variant in `DirectoryFilters.jsx:70`.
- Every `target="_blank"` has `rel="noopener noreferrer"`. All 13 of them.
- `autoComplete` tokens on auth/signup/address/password fields are correct and
  specific (`new-password` vs `current-password`, `address-line1`, etc.).
- `Messages.jsx` chat input: Enter sends, Shift+Enter newlines. Correct.
- Dropdowns render through `DropdownPortal.jsx` — no z-index roulette.
- `NotificationBell.jsx:81` and the header avatar menu both close on outside
  click *and* Escape.
- Real server-side pagination with explicit "Load more", not a scroll hijack.
- `ErrorBoundary.jsx` and a `*` → `NotFound` route both exist.

---

## Suggested order

1. Dirty-state guard on the four composers (#1) — only item that loses work
2. Escape on the composers (#2) + the five modals (#8)
3. Shared `useFocusTrap()` hook (#7)
4. Cards → real links (#4), which also fixes #5 and #6
5. Job Share → copy the URL (#3)
6. Wrap forms in `<form onSubmit>` (#10) + `react/button-has-type` lint (#11)
