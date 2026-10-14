# Hosted service foundation — in development

The code in this development branch is not a released or deployed service.

This separate Django service currently implements accounts, private and shared
workspace identities, member permissions, email-bound invitations, and scoped
JSON board/catalog storage with history and rejected-save copies, protected
streaming uploads/media access, reviewed interrupted-upload recovery and offline
current-store snapshots with verified empty-store restoration. A separate
responsive portal serves login, invited registration, workspace selection and
owner-managed members/invitations, a scoped board shelf and a first responsive
spatial note editor with a protected media library. Saved-text search and a
bounded static preview of registered HTML are staged below. Research tasks and
remaining unsupported scoped routes deliberately return `501` after
checking membership. Unscoped desktop file APIs are unavailable.

Do not expose this foundation as a complete hosted whiteboard. Complete node editing, password recovery, real-time
collaboration, full browser integration, registered-file cleanup,
operational/offsite backups and deployment are unfinished. No
desktop data is read or imported by this service.

The independent [development container package](deployment/README.md) separates
operator configuration, offline initialization, application serving and recovery.
It is not a deployment authorization or evidence of external HTTPS, full device
support, safe file cleanup or real-time merging. Actual Linux/container workflow
results are required; desktop Linux tests do not substitute for hosted checks.

## Original-value reconciliation and limited editor collaboration (development)

An explicit `POST /w/<workspace>/api/boards/<key>/reconcile` accepts only
`{"baseETag": "the original strong tag", "board": <the complete author input>}`.
For reconciling an older tag, the base must be a complete retained server revision in that exact board and
workspace, with uninterrupted history and no intervening trash/restore transition.
Client-supplied base documents and private conflict copies never supply authority.
The server rechecks the original account and fresh editor role under the same
workspace transaction as the write, then returns the complete accepted board and
its strong ETag. Regular conditional PUT behavior is unchanged.

Independent nodes and independent known note field groups can retain both
original submissions. Text/format, geometry, appearance and table structure stay
in groups; attachment nodes and changed unknown extensions stay whole. Concurrent
ordering changes, deletion versus editing, identity collisions, overlapping text,
missing bases and invalid combined references refuse reconciliation. The exact
submitting author's input follows the existing private conflict-copy/quota policy;
no text is synthesized, silently concatenated, normalized or transferred to
another workspace. Appended nodes follow the already committed order before this
submission's new nodes. A stale no-op creates no revision or false author update.

A successful response is the authoritative combined board. An editor must adopt
or safely rebase that full result before its next save; keeping the old local
snapshot with the new ETag would overwrite the other author's changes. The
spatial editor now calls this endpoint for existing boards. After acknowledgement,
it rechecks identity/membership, adopts the full result and rebases subsequent
local typing only when original-value groups remain independent. An overlap after
acknowledgement keeps later input and its old recovery base; it does not label that
later input saved or automatically retry a failed write.

Clean visible pages check `GET /boards/<key>/live` approximately every 2.5 seconds.
Conditional replies include the fixed original account/workspace/board and fresh
role even when the version is unchanged. Dirty input, composition, a captured
gesture and pending modal operations defer receiving. Changes to the clean focused
note wait until the author leaves that field; unrelated note updates preserve its
caret and selection. Local camera/navigation do not follow another page's view.
Accepted saves wait for active composition/gestures before adopting a result.

Undo applies the inverse of this page's own operation to the current originals.
Independent peer fields and appended nodes survive; a later overlapping edit
refuses Undo without popping its history entry. In small windows the same existing
Undo/Redo and library buttons move into the sticky editor heading, where the
inspector no longer covers them. The same account-bound library button remains
available while writing a note, frame or table; closing or widening returns
each single original control to its canvas position. A real 390px/320px
whole-editor HTTPS check reproduced the covered library entry before this
change and verified actual clicks after scrolling, lookup, preview, exit and
reopening afterward. The note input remains unchanged; the library retains
its submitted lookup on reopening. This does not claim physical-device testing.
Updates use a polite status line without moving keyboard focus, informed by
[W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
and [focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
These are implementation choices checked with real operations, not an
accessibility certification.

Additional isolated whole-page localhost HTTPS acceptance now covers saved-text
results opening the fixed-workspace board with original manual geometry,
registered metadata lookup beyond the first forty items and original pagination,
static HTML layout in the full editor with opaque-origin isolation and blocked
author scripts/external requests, exact original download, both narrow widths,
real viewer access and refusal of foreign-workspace identities. Logging in as
another actual member of the same workspace pauses the old original-account
library and clears its results/preview while preserving note input. These six
distinct behavior groups were completed across focused fixtures, not one
uninterrupted suite. Stored board/history rows and registered original hashes
remain unchanged. The temporary service/browser close afterward. A verified
local certificate probe accompanies the browser's local certificate exception;
external DNS/TLS, physical devices and deployment remain unaccepted.

Unsupported JavaScript number representations stop editing before lossy conversion;
the exact originally returned JSON remains exportable. This includes unsafe
integers, excessive decimal precision and integral decimal tokens whose integer
type would otherwise change. Recovery input has the same guard.

This is bounded original-value collaboration, with periodic reads rather than a
push transport. It is not character CRDT merging, full concurrent table editing,
hardware input-method/device acceptance or deployed collaboration. Isolated native
Windows Chromium HTTPS operations use synthetic accounts and data; browser TLS
errors are ignored only for that temporary local certificate. They do not prove
external-domain HTTPS or actual multi-device acceptance. Independent trusted-CA
preflight and Linux/container recovery checks are separate.

The related no-op guard now compares canonical JSON bytes, so opaque Boolean,
integer and decimal changes are actually stored instead of Python equality
incorrectly treating them as unchanged. Original author strings remain exact.

The retained-base approach is informed by the three-way merge model described
in [Git's merge documentation](https://git-scm.com/docs/git-merge); field grouping
and refusal rules here are conservative application choices. Keeping reconciliation
separate from ordinary conditional PUT follows the precondition distinction in
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match).

## Media time notes (staged experiment)

An opened, registered audio/video canvas card offers **留便签** at the current
native media position. It captures the position before asynchronous checks,
verifies original workspace edit access and the registered asset's exact ID and
byte hash, then creates a blank auto-sized author note beside the original card.
No observation text is generated. Original nodes, file bytes, manual sizes and
unrecognized metadata remain unchanged; existing desktop timeline markers are
not converted into this separate `mediaCue` extension.

The note's **回到原片段** action opens a small original-context viewer, seeks after
metadata is available and stays paused until the author explicitly plays.
Closing stops that viewer and returns to the previous camera, selection and
field range. Detaching the time association requires confirmation and supports
Undo; it does not delete the author's note or file. Each read/download uses the
page's fixed original account/workspace and protected media route. Unsupported
metadata, unavailable times, a changed file hash or lost access remain explicit
and never redirect to a different file. Late responses cannot replace a newer
viewer or create a note after the original target changes.

Independent Windows Chromium HTTPS checks use a registered synthetic PCM WAV
for actual native playback/seek, return, author save, Undo, narrow viewport,
read-only/downgraded membership, delayed responses, original-file byte equality
and cross-workspace refusal. Video shares the guarded native-media path but its
decoder/playback is not verified by these WAV checks. Finite-file duration must
be available; live streams are not supported. Saved seconds retain native
precision; the badge only rounds its display to milliseconds. Decoder seek
accuracy can vary. This experiment is unreleased and undeployed; it does not
establish real-time collaboration, physical-device support or full editor parity.

The interaction uses the native [HTMLMediaElement currentTime model](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)
and follows [W3C guidance on author-initiated audio](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html).
These sources inform seeking after metadata, explicit playback and a visible
exit; the layout and exact return behavior are implementation choices checked
with synthetic operations, not an accessibility certification.

## Account password and login controls (staged)

The portal and board editor share an account panel with original-account-bound
password changes and login records. Every operation checks the page's fixed
`X-Creative-Account`, fresh session credential and current password; mutations
require CSRF protection and have account/address attempt limits. New passwords
use the configured strength validators and Argon2 in production. Changing a
password rotates the current session key and keeps that login, atomically
removing the account's other sessions. A failed transaction restores the
original password/session state. Passwords are never written to browser draft
storage, and panel close/account loss/completed submission clears its inputs.

Records contain opaque public UUIDs, start/expiry times and a coarse self-reported
browser/platform label. They never expose the cookie session key, raw user agent,
IP or a claim of verified hardware/last activity. Reads cover at most 100 live
records for the authenticated account; an oversized list refuses review instead
of hiding additional targets. An exact reviewed ETag, current password and explicit
confirmation are required to revoke one other login or the listed other logins.
A changed list requires a new review. The current record uses normal explicit
logout. This does not revoke future logins or cancel already authorized in-flight
requests; revoked pages lose access at their next check/request and retain their
own local editor input/export. Save conflict checks remain distinct from realtime
collaboration. Closed panel callbacks cannot repopulate new choices/passwords.

Sent, acknowledged and subsequently verified results have different messages.
A missing/truncated response never triggers an automatic retry. An acknowledged
operation followed by loss of access stays acknowledged but unverified.
Forgotten-password recovery is available through the staged trusted server
operator command described below. Self-service email recovery/delivery is
**not implemented**; an email input alone does not provide it.

This unreleased preview uses `core.sessions` and the `core_accountsession` table
(migration 0005), whose account index avoids scanning other accounts' session data.
Existing preview cookies from the earlier default Django session engine require
a new login; they are not silently promoted or copied. Offline backup verification
now requires the new table and compatible migrations, and preserves public IDs,
start times, labels, credential data and prior revocations in the exact SQL copy.
Older preview snapshots need their matching program version and a separately
reviewed migration procedure; do not bypass validation or overwrite an original
store. Linux/device/external TLS/operations/deployment remain unverified.

Implementation references: [Django session invalidation and preserving the
current login](https://docs.djangoproject.com/en/5.2/topics/auth/default/#session-invalidation-on-password-change),
[extending database sessions](https://docs.djangoproject.com/en/5.2/topics/http/sessions/#extending-database-backed-session-engines).

## Board session and browser recovery modules (staged)

The portal's explicit asset whitelist also serves three ES modules:
`board-transport.js`, `board-drafts.js` and `board-session.js`. They form the
editor's data boundary and now support the spatial note editor described below.
Construct one `BoardSession({account, workspace, key})` per page. Its account,
workspace UUID and board key are copied and frozen. All requests use that fixed
URL and original account header; cookies or a mutable active-space preference
cannot redirect an older page. `open()` reads the server version and role.
`open(rawJSON)` starts an explicitly supplied new board under `If-Match: new`.
No authored content is invented or merged. Unknown original JSON fields remain
in the raw snapshot; the server remains the complete format/permission authority.

`updateRaw(rawJSON)` retains exact input and attempts an IndexedDB recovery row.
Each page has its own random identity beneath its account/workspace/board index;
two pages cannot overwrite or automatically clear each other's inputs. A local
write is confirmed only by transaction completion, never just request success.
Rows are bounded to 8 MiB each, 64 MiB of raw input and 128 rows per origin. Full,
blocked, incompatible or denied browser storage is an explicit local failure;
older inputs are not silently expired to free space. The page retains its memory
copy and `exportRaw()` even if local storage fails. This is browser-only recovery,
not a cross-device copy, encrypted store, server backup or guarantee against
browser eviction/profile deletion. Explicit inspection/application/export is available
in the board editor; reviewed deletion and workspace-wide recovery controls
still need a user interface.

`save()` captures one input/version and sends at most one pending request. Typing
while it waits remains dirty; a successful response updates the remaining draft's
base version instead of clearing it. A confirmed save clears only this page's
exact acknowledged row. Conflicts stop further saving and preserve the submitted
input separately from later typing. `state.conflict.draftSaved` refers only to
the submitted snapshot's server conflict copy; quota may prevent that copy.
Missing acknowledgement versions are unconfirmed, even when a server may have
committed the request. No new ETag is silently adopted after a conflict.

`checkAccess()` diagnoses the original account and membership without replacing
input. Logout/account change, missing access and viewer downgrades stop old-page
writes. A late diagnostic or acknowledgement cannot resume a stopped page.
Connection failure does not itself prove logout: an available session/ACL is
checked without automatically retrying the write. `recoverableDrafts()` explicitly
checks fresh original-account access before reading this board's browser rows.
`recoverWorkspaceDrafts({account, workspace})` checks before and after listing
that account's workspace rows, including input for a board since deleted. It
never reads/recreates the deleted board or automatically applies a row. A newer
account's valid membership in the same workspace does not authorize old-account
recovery. These data modules perform no real-time synchronization. Actual localhost HTTPS/Chromium/IndexedDB checks cover held
saves, conflicts, cookie changes, role/deletion changes, transaction aborts and
storage bounds. Physical devices, Linux serving and external deployment
remain unverified.

## Spatial note editor (staged)

`/w/<workspace-uuid>/b/<document-key>/` binds a page to its original account,
workspace and board. `/w/<workspace-uuid>/new/<document-key>/` requests a new
blank document with an author-entered name. Anonymous visitors sign in and return
to that server-fixed route; query parameters cannot choose another destination.
HTML embeds no board or workspace contents. Fresh scoped APIs authorize every
read/save. New creation uses `If-Match: new`, and the URL becomes a saved board
only after acknowledgement. A viewer cannot create or edit.

The editor renders notes on a charcoal spatial canvas with a separate focus pane.
It supports author-entered title/body/supplementary text, native text selection
formatting (bold, italic, strike, code, headings, quotes, lists, tasks, fences),
plain/Markdown display, seven paper colours, exact hex choices, plain/lined/grid
paper, font size and auto/manual dimensions. New notes contain empty authored
fields and grow with content; manual dimensions and original unknown fields are
preserved. Undo/redo retains complete JSON snapshots in bounded page memory.

Pointer drag moves content; blank-space drag pans; wheel/buttons/fit zoom. A
narrowing viewport reveals an otherwise offscreen selection/content. Camera
changes are page-local: the original saved view is retained rather than claiming
camera synchronization. Tables show a limited canvas preview with a separate
text/row/column inspector; frame boundaries and current-board note references
also have staged editing controls, described below. Complete embedded-cell
media/content editing and cross-board reference discovery are still unfinished.
Other original nodes and edges remain in the JSON and can move. The editor never
invokes desktop filesystem APIs or reads supplied file
paths. Markdown HTML and images are inert; links retain the parser's URL checks.

Autosave waits briefly after an edit, always within the original session, with
one pending save. Conflicts stop autosave, preserve the accepted version, and
retain the submitted input separately from later typing. Recovery explicitly
checks original-account access, shows original excerpts and full JSON, and offers
inspection/export before an author-confirmed whole-board replacement. Applying
on a fresh page uses its current version and is undoable; it does not merge other
authors' words. Browser rows cannot be treated as a durable server backup. Inputs
that exceed the raw byte bound remain in the page and can be exported; the editor
does not save an older snapshot or claim the extra input is in its browser row.
Reducing the input can make saving possible again.

Focus, restored pages, visibility and session notifications check access. A
changed account or read-only downgrade stops editing while retaining exact input
export. Reloading never automatically applies another page's recovery row. The
workspace-wide recovery API exists, but recovery for deleted boards, reviewed
row cleanup, history/trash/capacity controls and complete account
operations still require interfaces. This staged editor is not a deployed service
or real-time collaborative editor. Local HTTPS browser tests cover desktop and
320px layouts, emulated touch, actual save delays/conflicts and data preservation;
physical-device and external-domain acceptance remain required.

## Protected media library (staged)

The editor's library lists bounded pages of safe asset metadata in its original
workspace. Opening a file is explicit; listing or reopening a board never starts
all its media downloads. Recognized images/audio/video use native elements with
same-origin protected URLs, bound to the page's original account. Unknown or
active content, including HTML/SVG/PDF, remains a download attachment. No frames,
desktop paths, arbitrary external image URLs or automatic media playback are used.
The editor HTML alone permits same-origin image/media sources; API and attachment
responses keep their restrictive content policy.

Selecting or dropping one File retains it in page memory. Confirmed raw upload
sends its exact bytes to a captured stable library folder ID, never a later folder
label or active-workspace preference. The visible single-file limit rejects
obviously oversized selections before sending; fresh server quotas/permissions
remain authoritative. Progress reports bytes sent separately from server
confirmation. Cancel, timeout, lost response or failed final identity verification
can leave an upload unconfirmed even if already registered. The original File
stays available; check the original workspace list before explicitly confirming
a retry that could duplicate it. Cancel before the identity check finishes prevents
the request from being sent. Closing/reloading a pending upload prompts first.

An upload does not add anything to the board automatically. Explicit placement
adds a movable reference with a safe `assetId`; all original board fields remain.
Opened native media stays mounted while another note is edited, and its controls
do not drag the card. Connection/access loss clears mounted media; an explicit
successful save can restore lazy media controls without resuming playback. Viewer
downgrades disable upload/placement while retaining permitted viewing. Account or
membership changes clear the library and pause its original destination. A late
preview cannot reopen a closed dialog. The selected details reserve preview space,
keep keyboard focus and offer a visible exit after scrolling on narrow viewports.

Actual local HTTPS tests cover PNG/WAV bytes, native WAV controls, upload progress,
stable folder changes, early connection closure, cancel/delayed responses, account
and membership changes, original-scope isolation and desktop/320px layouts. Video
decoder and physical-device acceptance remain unverified. The author-controlled
metadata and reviewed directory forms are described below. Directory moves, safe registered-file
removal and complete media lifecycle controls remain unfinished. This library
is neither realtime collaboration nor a deployed cloud service.

### Distance reading in the original canvas (staged)

Below 45% zoom, the existing note and table cards show a wrapped name view at
9–12 projected pixels. The literal original title is used; an untitled note uses
its first nonblank authored body line, and empty cards use an explicit empty
label. Names have at most three lines within their own projected card, retain the
complete text in the native title and card name, and open the original inspector
through the same point or Enter operation. They do not invent or rewrite content.
At closer zoom the original paper returns. Current protected media stays mounted
and retains its explicit playback state; media cards and frame boundaries keep
their existing view.

The existing Reading dialog can switch back to original paper, restore the
opening choice or return to defaults. Only the fixed original account/workspace
browser preference records the font and `smart`/`paper` mode; old font-only values
retain their font and use adaptive names. Other accounts/spaces do not inherit
the choice, and refused storage remains an explicitly temporary preview. Gesture
and composition boundaries defer incoming changes without rebuilding captured
cards or rewriting active inspector input. Rendering is batched per animation
frame and preserves actual automatic-paper height and original geometry/versions.
Existing short manual notes/tables use their already displayed 96px minimum for
names, connection centres and Fit; their smaller authored dimensions stay intact.

Using visible original names for navigation follows the recognition principle
in [NN/G's recognition-versus-recall guidance](https://www.nngroup.com/articles/recognition-and-recall/).
Native projected-font, paint/hit bounds, neighbouring selection and before/after
screenshots determine this implementation's usable limits; extreme zoom may show
only paper shapes. This is not per-note authored typography, synchronized/named
hosted appearances, physical-device/IME acceptance or deployment.

### Author-controlled metadata form (staged)

The library now offers an explicit title, notes, individual tags and existing
stable-folder destination form. It keeps the original file, byte hash and asset
identity unchanged; changing a library description does not rewrite author-entered
board titles. Opening alone does not normalize untouched line endings, multiline
labels, empty labels or duplicate tags. Viewers can inspect and export but not edit.

One retained form owns an immutable original account, workspace, asset and strong
version. Closing, refreshing the list or selecting another asset cannot discard
or retarget unsaved input. Before replacing this form, save or explicitly discard
its edits; it can always be exported as a scoped JSON input. Its pending input is
held in this page only, with an unload warning, not in browser storage or a server
metadata-conflict snapshot. Save or export before leaving or reloading.

Confirming sends one exact-version PATCH. Typing during the wait remains separate
from the submitted snapshot; an accepted reply advances the confirmed base without
replacing later input. A conflict or unverifiable response blocks resubmission and
keeps the old basis. Read the server's complete name, description, labels and
location, explicitly choose that inspected basis, then confirm a separate save
of the user's full four fields. No automatic merging, retry or adoption occurs;
another intervening edit still conflicts. Missing destinations retain their old
stable ID until explicitly replaced, and permission/account changes pause writes
while keeping the author's own form available for copying/export.

Ctrl/Command+S in the open metadata form confirms that form only; other modal
windows do not send canvas save commands. Native text undo and Escape remain
local to the active window. A closed form or detached tag row cannot replace
retained input through a late DOM event; continuing restores the retained fields.
Save feedback shares the sticky confirmation area, so its current result remains
visible above the actions on both desktop and short narrow windows.
An exact unchanged PATCH still verifies the original account, current editor,
workspace, folder and version, but preserves the asset row, timestamp and ETag.
It therefore does not consume extra quota or invalidate another author's basis.
Stale equal fields still require conflict review; this is not automatic merging.

The form has reachable exits and confirmation actions on narrow viewports. Media
players remain mounted when their description is saved. Metadata input recovery across reload, registered-file
lifecycle and real-time collaboration remain unfinished. Local synthetic HTTPS
browser checks do not replace physical-device or external TLS acceptance.

### Reviewed library directories (staged)

The library can now create an empty directory under an explicitly selected
stable parent, rename a directory with all descendants, or remove a reviewed
directory range. Each operation first lists its complete affected paths without
writing; separate confirmation sends one exact-version catalog PUT. Rename keeps
all position IDs, adjacent name prefixes and original media bytes. Removal is
refused by the backend if any registered media still references that range. It
never deletes files or implicitly moves them to root. Folder moves/reparenting
and registered-file removal are not provided by this form.

The page retains one operation under its original account and workspace.
Closing, delayed replies, changed login, lost roles and interrupted connections
cannot redirect its destination. An accepted response is checked against a
fresh catalog and original identity; later typed names remain separate and must
be reviewed again. Unverifiable replies block retries. Missing selected IDs stay
visible as missing, including in the upload destination selector; they never
become root or a new directory with the same name.

After a conflict, inspection alone does not adopt a version. Explicitly choose
the inspected tree and review this single operation again, preserving other
authors' new directories. The old complete catalog is never blindly retried
with a fresh tag. Another intervening change still conflicts. Native media
players stay mounted during a successful rename; only their captions and
destination labels are updated.

Own operation export contains the selected scope, original version, own intent
and reviewed changes rather than an unrelated full tree. Input is retained in
this page only, with an unload warning; save or export before reload. No durable
operation recovery or automatic exported-input application is claimed. Read-only
members can inspect the tree; revoked access clears fetched trees. Real local
HTTPS browser flows cover concurrent edits, held acknowledgements, bad versions,
initial-read failure, 320px layout/focus and top-dialog Escape. These are staged
checks, not deployment, realtime or physical-device acceptance.

## Account and workspace portal

Open `/` over HTTPS for login and workspace selection. Each account has a private
space and can create shared spaces. `/w/<workspace-uuid>/` is an immutable
destination: its HTML shell embeds only the original account and requested UUID,
and authorized APIs load the actual workspace/member data. An unavailable space
never falls back to a different space. Its board shelf links to fixed editor
destinations and offers author-named blank creation to editors and owners.

Owners issue an email-bound invitation and manually copy/share its one-time link.
The `/join#token=...` fragment is handled locally, removed from the address bar,
and submitted only inside a JSON body after explicit registration/acceptance.
Reload/close prompts before dropping an invitation still held in page memory;
canceling keeps its exact code. Successful login carries it to the new account
page; acceptance remains explicit. An existing account signs in first and confirms acceptance under its displayed
email. A failed operation retains fields; duplicate pending submissions are
blocked. Invite links are not automatically sent and original tokens cannot be
retrieved again. Read-only/editor members see names/roles, without owner email or
management controls. Server checks remain authoritative.

The page retains its original account for **all** workspace/member/invitation
reads and actions, including creating a space, accepting a link and logging out.
Send `X-Creative-Account` on these authenticated requests. Missing identity is
`428`; a newer valid cookie cannot authorize an older page (`409 account_changed`).
Login cannot silently replace an already authenticated account; explicit logout
from that account's page is required. Cross-tab notifications contain no account
data: a fresh session read decides whether to pause the old page. Focus, restored
pages and visibility changes also recheck. A paused page retains author inputs
and choices in memory, clears the password, disables submissions and offers a new
page. Closing/reloading portal forms is separate from the board editor’s explicit
browser input recovery. Browser storage has no portal forms/passwords.

HTML loads only explicitly whitelisted program assets. The editor also uses
the existing repository-vendored markdown-it file through one fixed alias; its
license remains in `../vendor/`. Its content policy allows
same-origin external scripts/styles/API connections with no inline execution;
JSON and active file responses retain the restrictive policy. There is no generic
static file server or desktop API fallback. Locally verified layouts cover desktop
and 375/320px browser viewports, not physical-device or external-domain acceptance.

## Development checks

Create an independent Python virtual environment and install `requirements.txt`.
From this directory, run:

```sh
python manage.py test core --settings=service.test_settings
python manage.py makemigrations --check --dry-run --settings=service.test_settings
```

The explicit test settings create temporary data outside the checkout. Their
fast password hasher and insecure localhost cookies must never be used in a
deployment. Default settings require a long independent secret, explicit host
names, and an absolute data directory outside the program directory. Default
cookies require HTTPS. Proxy header trust is disabled unless explicitly enabled;
an enabled proxy must overwrite forwarded protocol and `X-Real-IP` headers and
prevent clients reaching the application directly.

The first account can later be initialized locally with `bootstrap_owner`, which
prompts twice for the password rather than accepting it in command arguments.
Subsequent registration requires a valid invitation. There is no anonymous
registration endpoint, exposed admin site, self-service password recovery or
email delivery yet. A forgotten password uses the reviewed local
`recover_account` command described below.

## Current API boundary

Use `GET /api/session` to establish a CSRF cookie, then send the current cookie's
value as `X-CSRFToken` for every mutation, including login. Login rotates both the
session and CSRF token. Credentials and invitations belong in JSON request bodies,
never query parameters. Account mutation requests are JSON, bounded to 64 KiB.
Document JSON has a separate default 8 MiB limit.

- Account: `POST /api/login`, `POST /api/logout`, `POST /api/register` (invited).
- Own login records: `GET /api/account/sessions`; reviewed `POST /api/account/sessions/<public-uuid>/revoke` or `POST /api/account/sessions/revoke-others`.
- Own password: `POST /api/account/password` with current password, validated new password and confirmation.
- Workspaces: `GET /api/workspaces`, `POST /api/workspaces` (shared, author names).
- Scope: `/w/<workspace-uuid>/api/workspace` fixes the workspace for that request.
- Members: scoped `GET /api/members`, owner-only `PATCH` or `DELETE /api/members/<account-id>`.
- Invitations: scoped owner-only `GET` or `POST /api/invitations`, `DELETE /api/invitations/<invitation-uuid>`.
- Accept: `POST /api/invitations/accept` with the one-time token for the logged-in recipient.

Owners can invite editors or viewers; personal workspaces cannot be shared.
Reissuing an invitation invalidates the older token. Tokens expire after seven
days and only their SHA-256 digests are stored. The plaintext is returned once to
the owner for future manual sharing; this service sends no messages. Revoking an
accepted invitation does not silently remove a member: use explicit membership
removal instead. Membership and account status are rechecked on later requests,
including requests from an existing session. Superusers have no automatic access
to another person's workspace.

The SQLite database currently serializes workspace membership writes to enforce
invitation consumption and member limits. Authentication attempts use persistent
bounded buckets, keyed by HMACs rather than clear-text addresses. These limits
have not been capacity-tested or tuned for a public service.

## Staged document API

Document requests must include `X-Creative-Account` with the account ID captured
when the page opened, in addition to the workspace fixed in its URL. A missing
identity returns `428`; a changed logged-in account returns `409` and preserves
the caller's draft. Knowing an account ID grants no access: session authentication
and fresh membership checks still apply. Mutations also recheck the member's role
under the workspace transaction lock. These safeguards are implemented at the API
boundary; the staged editor sends them on every scoped document request.

Within `/w/<workspace-uuid>/api`:

- `GET /boards` lists boards; `GET`, `PUT`, `DELETE /boards/<key>` read, save, or soft-delete one.
- `POST /boards/<key>/restore` explicitly restores a deleted board.
- `GET`, `PUT /folders` manage the board folder catalog.
- `GET`, `PUT /assets` currently manage **library folders only**. Nonempty asset arrays return `501`; client filesystem references are never read.
- `GET /history/<board|boards|folders|library>/<key>` lists retained revisions; append `/<revision-uuid>` to read an immutable version. Catalog keys are `catalog`.
- `GET /trash` lists deleted boards and their current ETags.
- `GET /conflicts` and `GET /conflicts/<draft-uuid>` retrieve the current account's rejected inputs; `DELETE` explicitly removes one while edit permission remains.
- `GET /quota` reports JSON payload bytes for current state, retained history, and rejected input copies.
- Owner-only `GET /history/<kind>/<key>/cleanup?keep=<count>` previews permanent
  history cleanup, keeping at least the current version; `POST` to the same path
  applies the reviewed plan with `{"keep": <count>, "confirm": "discard_history"}`.
- Owner-only `GET /boards/<key>/purge` previews permanent removal of a board
  already in the trash; `POST` uses `{"confirm": "discard_board"}` to apply it.

Ordinary document saves, deletes, and restores need the exact strong `If-Match` ETag returned by
a read, or `new` for creating an absent document. ETags include the workspace and
document namespace. A stale save does not overwrite or merge. The server stores
the submitted valid JSON separately for its author and returns `409` with
`draftSaved`, `draftId`, and `draftURL`. Identical retries reuse the same copy.
Workspace owners cannot read another member's uncommitted copy. If the copy cannot
fit within its quota or count limit, `draftSaved` is explicitly false; the page
must retain its own input. Lost membership also denies later access to shared
versions and copies. A deleted document cannot be silently recreated by a stale
save or a reused `new` ID.

Retained history defaults to forty versions per document. The default 128 MiB
workspace limit counts current document payloads, history, and rejected copies;
it is **not** a physical disk limit or a media quota. Failed writes roll back
content, history, and pruning together. Exact authored text, formatting fields,
manual dimensions, node ordering, and links are preserved. Folder removal cannot
orphan existing boards; its full interface flow remains to be implemented.

Both cleanup mutations require the exact strong `If-Match` **plan** ETag from
their preview, not the board's ETag. The plan binds the workspace, document,
action, retention choice and complete current version list. A changed document,
restoration or history list invalidates the plan; viewing a plan performs no
cleanup. Missing confirmation does not discard data. Current content and another
author's uncommitted input copies are never removed by history cleanup. Edits,
membership changes and cleanup serialize under the same workspace lock.

Cleanup can run when the configured JSON quota is already full or has been
lowered. This makes it possible to explicitly remove old history and retry a
soft delete that could not fit its new history record. A permanent board removal
clears its content and history but keeps a compact title/identity tombstone:
old saves or a reused `new` ID cannot silently resurrect it. Restoration returns
`410`, and rejected new input can still be retained privately when there is
capacity. These identity tombstones continue to count toward the document-count
limit. Private input copies are unaffected and retain their author's access rules.

The reported reclaimed bytes are JSON payload accounting, **not** a promise that
the SQLite file shrinks or a secure erasure of old backups. The cleanup interface,
full disk limits and physical database maintenance are not implemented yet.

API conflict-copy preservation is not real-time collaboration, and no automatic
merging or generation of authored content occurs.

## Required next integration

All remaining preview, search, and research-task
storage must receive the same explicit immutable request scope. Never change the desktop
server's global `ROOT` between requests, use an active-workspace cookie to route
saves, or allow server filesystem paths in hosted references. Every tab must keep
its account/workspace context, including local storage, clipboard coordination,
and background requests. Changing accounts must preserve unsaved drafts and stop
older tabs writing under the new account. Read-only members must be denied by the
server, not merely by hidden interface controls.

Reliable concurrent editing, migration copies, deployment quota/load tuning,
Linux filesystem/recovery checks, operational backups, container configuration
and external HTTPS checks remain mandatory before deployment. The staged offline
snapshot/recovery checks cover the current store; save-conflict protection alone
is not real-time collaboration.

## Staged file and media API

File records are separate from the folder catalog and have server-generated UUIDs.
No record contains a caller-supplied server path. Within the same scoped API:

- `POST /assets/upload` sends the raw file body as `application/octet-stream`,
  its exact `Content-Length`, a UTF-8 percent-encoded `X-File-Name`, and optionally
  a stable `X-Folder-Id`. CSRF and the original account header remain required.
- `GET /assets/items?limit=100&after=<uuid>` returns bounded pages of file metadata.
- `GET /assets/items/<uuid>` reads a record; `PATCH` edits author-supplied
  `title`, `notes`, `tags`, or `folderId` with its exact `If-Match` ETag.
- `GET /media/<uuid>?account=<original-account-id>` reads registered content.
  The account query is needed for media elements that cannot send custom headers;
  it grants no permission, and a changed session account rejects the old URL.
- `GET /media-quota` shows the workspace's usage/reservations and the current
  account's own upload budget, without exposing other accounts' usage.

Uploads read 64 KiB chunks into an opaque pending file and hash the exact original
bytes. A storage budget lock reserves space before reading the body, including
concurrent uploads. Defaults are 128 MiB per file, 2 GiB per workspace, 4 GiB per
uploading account, 8 GiB globally, a 512 MiB free-disk floor, and three pending
uploads per account. Those defaults still need deployment tuning and load checks.
Asset metadata also counts toward the workspace's JSON payload quota. Roles and
the stable destination folder are rechecked before atomic promotion/registration.
A renamed folder retains the upload; a removed folder never reroutes it to a new
same-name folder. Registered files remain immutable; replacement, archival and
file cleanup are not implemented yet.

Media responses support one byte range, suffix ranges, `If-Range`, and `HEAD`.
Metadata-only edits do not change the underlying content ETag. Membership and
account status are checked again between streamed chunks, so removing access
stops further delivery; already delivered bytes cannot be recalled. Files and
directories that resolve through a redirect, including one into another
workspace, are rejected. A missing or size-mismatched registered file fails
closed instead of falling back to a filesystem reference.

Only recognized inert image/audio/video types are served inline. HTML, SVG,
PDF and unrecognized content remain download attachments with `nosniff` and a
restrictive policy; HTML previews require a separate sandbox implementation.
Media URLs use `no-store` and never provide unauthenticated public links.

Normal interrupted/rejected transfers remove their own unregistered pending file
and release their reservation. If a database failure makes commit status
ambiguous, the file/reservation remains accounted for rather than risking a
registered asset. A reviewed offline reconciliation command is now staged below.
Unreserved-file audits, registered-file cleanup, browser media/editor integration
and real device checks are unfinished. Offline snapshots/restoration are staged
below; scheduled/offsite backup operation remains unfinished.

## Registered file association inspection (development preview)

In the board library, select a registered file and choose **查找关联**.
The original-account, original-workspace endpoint
`GET /assets/items/<uuid>/references` inspects current boards, trash, retained
board/directory versions and only that account's own server conflict submissions.
The panel distinguishes explicit `assetId` references (including nested cells,
media cues and preserved extension fields) from IDs merely mentioned in text.
Current board links open a separate tab after a fresh account/access check;
historical rows are inspection evidence and do not apply old content.

The snapshot is bounded to 500 saved records, 8 MiB of stored JSON, 100,000
visited JSON values, 1.2 seconds of scan time and 100 displayed matches. A
limit yields an explicitly partial result; excess matches have an exact count.
Historical scans load related document identity, not repeated current bodies
outside that budget. Limits do not describe arbitrary external files or disk
cleanup, and elapsed database/JSON decode time is not a hard request deadline.

Other authors' private submissions and unsaved browser input are excluded.
Empty results never certify a file as unused or safe to remove. This endpoint
has no mutation/delete method, does not read filesystem paths, and does not
change original files, document versions, quotas or authored content. Closing,
changing file or losing the original account invalidates late UI replies.
Registered-file cleanup and complete lifecycle reference protection remain
unfinished; this is a locally tested, unreleased development feature.

## Offline interrupted-upload recovery (staged)

All hosted servers must use `service.wsgi:application`. Each WSGI worker keeps a
kernel storage lease for its lifetime; maintenance obtains an exclusive lease
and fails if a worker is still running. Workers cannot start during maintenance.
Linux uses shared worker locks; Windows currently permits one WSGI process with
multiple threads. Actual Windows cross-process locking and release after forced
process termination are tested; the Linux lock branch still needs Linux checks.
Do not delete/replace `.hosted-maintenance.lock`, bypass the WSGI entry, run
custom writers concurrently, or use a filesystem that does not honor locks.
Normal shutdown must stop every worker and supervisor before maintenance.

Using the same explicit hosted settings/data directory, first stop the service
and preview:

```sh
python manage.py reconcile_uploads --service-stopped
```

This does not discard files or reservations. It shows the precise opaque upload
IDs, pending stages, hashes, bytes, and a `planToken`. Keep this output private;
it may contain authors' filenames. The plan is bound to the current store,
reservations and exact file identity/content. If the listed interrupted content
can be discarded and the authors retain their original files, confirm that plan:

```sh
python manage.py reconcile_uploads --service-stopped --plan-token <planToken> --confirm-discard-interrupted-uploads
```

This discards only unregistered files covered by those reservations and releases
their reserved budget. Already registered assets retain their exact media and
metadata; only a redundant reservation and extra pending copy are removed after
the registered content is verified. A missing or inconsistent registered asset
stops the operation for a separate integrity investigation. The tool refuses
redirected, linked or non-regular files, and changed/replayed plans. There is no
automatic expiry of uploads. Unreserved files and registered asset lifecycles
are outside this command's scope and remain untouched.

File deletion is not undone by a database rollback. If storage/database fails
partway through, some unregistered bytes may already be gone, while reservations
stay accounted for. Keep the service stopped, preview the remaining state, and
explicitly confirm a new plan to retry. Do not advertise an all-or-nothing file
rollback or erase registered assets to free capacity. This command is
interrupted-upload recovery tooling and does not clean registered or unreserved
files. The separate offline backup/restore tools follow below.

## Offline current-store backup and recovery (staged)

The current storage format includes all account/session/invitation/membership
tables, boards, folders, history, trash identities, each author's unapplied
inputs, file metadata and upload reservations in SQLite, plus the entire
`workspaces/` file tree. A snapshot preserves exact registered media, partial
uploads, unreserved files and empty directories. Nothing is automatically
cleaned during backup or restoration. Unknown top-level data directories fail
the backup instead of being silently left out; future preview/research/task
storage needs an explicit format extension when those features are built.

Stop every hosted WSGI worker and supervisor; use the same configured data store.
Create a backup parent directory outside that data directory, then provide a new
snapshot directory that does not already exist:

```sh
python manage.py backup_store --service-stopped --destination /absolute/backups/new-snapshot
python manage.py verify_backup --source /absolute/backups/new-snapshot
```

The exclusive maintenance lease denies backup while a guarded worker is running.
SQLite's backup API includes committed WAL content; raw copying of the main
database alone is insufficient. Files stream in bounded chunks with exact
SHA-256 hashes. SQLite integrity, foreign keys, migration compatibility and each
registered asset's independent database hash are checked. The completed package
contains `manifest.json` and `payload/`; keep its manifest hash and complete
package private. Hash verification detects changed content; it does not establish
who supplied the backup. Use an operator-trusted copy and transport.

For recovery, configure `CREATIVE_BOARD_HOSTED_DATA_DIR` to a different **new,
empty** data directory. Keep it outside the backup package. Do not run migrations
or initialize accounts there before recovery. Stop all workers for that new
store, verify the trusted backup, then use the returned `manifestHash`:

```sh
python manage.py restore_store --service-stopped --source /absolute/backups/new-snapshot --manifest-hash <manifestHash> --confirm-restore-new-store
```

The command refuses an existing store, rechecks the precise reviewed manifest,
copies exact files, and verifies the recovered database/media before permitting
WSGI startup. Failed copies remain for inspection; `.incomplete` packages cannot
be restored, and `.hosted-restore-incomplete` blocks serving a partial restored
store. Do not remove these markers to bypass verification. After interruption,
use another fresh empty target and preserve the failed copy for inspection.
Filesystem operations do not claim SQL-style rollback or overwrite the original.
Disk capacity is checked before copying; redirects, hardlinks and non-regular
files are refused. File data is fsynced on both systems; directory entries are
fsynced on Linux, whose branch still requires real Linux validation.

Restoration preserves accounts/password hashes, memberships/revocations, history,
unapplied inputs, permanent identity tombstones and pending capacity reservations.
Configure deployment secrets independently; they are not placed in the package.
Review recovered access and use offline upload reconciliation when necessary.
Production settings and actual localhost HTTPS in a new process have been tested
against a recovered generic fixture. External TLS, Linux/native symlinks,
scheduled/offsite/encrypted backup operation, previews/research data, full editor
integration and deployment are still unfinished. This is an offline snapshot of
the currently implemented store, not a live backup service or hosted release.

### Workspace records preview

The workspace shelf and editor recovery dialog provide a scoped records view:
retained board versions, the original account's unapplied server submissions,
trash and separate document/workspace-file/account-upload capacity snapshots.
Inspecting or exporting a record never applies it to the current editor. JSON
exports preserve unknown fields; plain note excerpts do not execute authored
HTML or fetch legacy media paths. Browser-only input remains in its separate
browser recovery view.

Trash restoration requires inspection, explicit confirmation, current write
permission and the exact reviewed ETag. It restores the original board identity
and retains its earlier versions. A new page is used to inspect the result; a
paused deleted-board editor is not silently resumed or overwritten. Closing
after submission does not retract a sent request. An acknowledgment and a
subsequent content check are reported separately, and uncertain writes are not
automatically retried. Server routes enforce the original account and workspace
on every request, including history, drafts and capacity.

This is a local development preview, not a hosted release. Applying a historical
version, permanently deleting trash, reviewed history cleanup and server draft
removal do not yet have interfaces here. Capacity figures describe configured
application limits, not free server disk. No automatic cleanup, live merge,
realtime collaboration or cross-device browser draft synchronization is claimed.

The note editor also provides current-board authored references. Markdown
`[[title]]`, `[[node-id]]` and `[[@board-key/node-id|label]]` mentions have outgoing
and incoming original-text excerpts; repeated title/ID mentions of the same
target share one row. Plain text, escapes and code examples are not indexed as
links. Duplicate names require an explicit choice. Missing or other-board
targets remain visible but do not fetch, create or silently retarget content.
No heading/block/embed or complete Obsidian compatibility is claimed.

An explicit chooser inserts into the selected original body, explanation or
annotation, using a stable ID and a user-authored label. It enables Markdown
display and participates in ordinary undo/redo and scoped saving. Invalid or
multiline labels are refused without rewriting them. Renaming a target never
rewrites authored source text. Navigation keeps up to16 page-local return
places with camera, field selection and panel scroll; it does not save camera
or cross-device navigation preferences. Table/media targets can be located
without claiming complete editing of those node types.

Lists initially show8 incoming/outgoing rows and20 chooser candidates, with
explicit expansion. No workspace search or extra document discovery request
is made. Readers can navigate authorized originals; insertion is disabled.
Loss of the original login closes the chooser, disables context navigation and
retains exact page input/export. A role downgrade also ends pending insertion
without applying it. Enclosing frames paint behind notes and their title is
the pointer drag area; saved geometry and original node payloads are retained.

Relevant parser checks can be run from this directory with
`node tests/note-references.mjs`; the served asset whitelist is checked by
`python manage.py test core.test_portal.PortalTests.test_only_explicit_portal_assets_are_served --settings=service.test_settings`.
These locally checked additions are still an unreleased development preview.

### Saved spatial views (development preview)

The editor can save an author-named current region, selected content bounds,
or whole-board bounds. Small spatial previews use existing geometry and colors.
Up to48 views can be renamed, reordered, explicitly given a new region, removed
and undone. They live in a versioned `spatialViews` document extension; original
nodes, unknown extension fields, text and `board.view` remain intact. Unsupported
or colliding extensions are retained and cannot be overwritten by this feature.

Browsing fits the same world region to the available screen. Previous/next and
Escape work outside native text/media inputs, with no motion animation or
automatic content arrangement. Exiting restores the starting page camera,
selected original field, selection and scroll. Navigation itself makes no PUT.
Once ordinary scoped saving is acknowledged, views load in fresh authorized
pages. This is shared document metadata, not real-time collaboration or a claim
of physical-device/deployment verification. Read-only members can browse but
cannot edit metadata; changed-login pages pause edits and retain page input.

Unsubmitted names remain in the original page when the dialog closes; explicit
discard removes only that pending naming input. This is not a persisted naming
draft after reload. If the local list changed, the author must review the current
list before applying a retained form. View changes use ordinary whole-document
ETags, scoped browser copies, original export and conflict handling. Conflicting
submissions are retained without automatic merging. The narrow inspector has
visible sticky close/navigation controls, and the opaque view panel sits above
it so lower text cannot obscure choices. The geometry/metadata checks are
`node tests/board-views.mjs`.


The staged hosted editor also edits existing `frame` nodes: exact authored title
and description, six boundary colours/custom hex, width/height/position, and
12/24/48 padding presets. Fit either the fully contained non-frame content or
explicitly all non-frame board content. Empty/invalid/out-of-range fits refuse
changes. Original cells, media IDs, manual node sizes, unknown node fields and
saved camera remain untouched. Dragging a label or stretching the visible
44px corner handle only changes the boundary; it is not group movement.
Keyboard arrows on the handle resize by one unit (Shift: ten), with undo.
Removal requires review, removes only that frame and its own edges, and keeps
contained content/other edges. Read-only readers can inspect fields; paused
accounts retain entered originals and export. Normal scoped ETag saving and
conflict retention apply, without real-time merging. New empty frames contain
no generated creative copy. This remains an unreleased prototype, not a
completed table editor or deployment. Geometry/preservation checks:
`node tests/board-frames.mjs`.

The staged table inspector edits exact author-entered title, description,
column headings and multiline cell text. New tables, rows and columns are
blank. Moving/removing a reviewed row or column carries its stable ID, known
`cellItems`/`cellImages` references and preferred column widths together. Known
sparse attachment grids gain only empty positions during an explicit structural
operation. Existing IDs are retained; legacy tables without IDs gain them only
when the author explicitly organizes rows or columns. Text edits do not add
IDs or normalize unknown original fields. Undo retains the complete document,
including original manual card dimensions and saved camera.

The inspector renders at most 20 rows and 6 columns per page, with inner
horizontal scrolling, sticky headings/row numbers and a visible narrow-screen
exit. Small tables show quiet counts without unused paging buttons.
Ctrl+Enter/Shift moves to the next/previous row, including page boundaries;
normal text arrows and Tab retain native behavior. Preferred column widths
100–900 and manual card dimensions are separate controls. Saved-view browsing
returns to the original stable cell, selection and grid scroll without a save.
Unsupported original attachment/width structures pause row/column organization
while retaining exact original data for text editing and export.

Read-only/downgraded/changed-account pages cannot edit cells or structure and
retain their original inputs/exports. Accepted delayed saves cannot overwrite
later cell text; stale concurrent saves keep the accepted version and the
other page's exact input without automatic merging. The cell inspector shows
bounded names/counts for existing contents, with a separate embedded-note
editor and protected cell-media viewer described below. It does **not** extract
file contents, fetch legacy paths, or provide real-time collaborative cell
merging. This is an unreleased prototype, not full desktop feature parity or
deployment.
Preservation/structure checks: `node tests/table-model.mjs`.

Pasting tab-separated multi-cell text into an original cell opens a review before
any board mutation. A single-column ordinary multiline paste retains native cell
behavior. The same review can be opened explicitly to paste comma-separated CSV.
No clipboard reads happen until the author's actual paste action. The first
incoming row remains content; headings are not inferred. The parser follows the
quoted-field and escaped-quote conventions in [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180),
accepts CRLF/LF/CR record boundaries, and preserves whitespace and quoted line
breaks. Ragged rows, malformed quoting and oversized inputs pause application;
they are never silently padded or truncated. Limits are 1,048,576 UTF-16 code
units, 5,000 rows, 100 columns and 50,000 incoming cells per action.

The preview names the exact starting row/column, reports changed/overwritten
cells and appended rows/columns, shows bounded literal before/after text and
states that incoming empty cells replace existing text. No formulas, HTML or
Markdown are executed. An explicit application changes just that rectangle;
growth appends blank headings and stable IDs. Original table geometry, existing
widths, unknown fields, attached images and complete embedded note/table payloads
remain; unsupported attachment ranges permit text-only paste but refuse growth.
The complete original table is checked again immediately before applying, so a
changed selection, table, permission or account cannot silently retarget a draft.
One application forms one complete-document undo step; no-op previews write
nothing. This uses the existing save/conflict system, not collaborative merging.

Close/Escape return to the original cell/caret and retain the unapplied source in
this page; a resume action, explicit discard, plain-text source download and
existing before-unload guard make that boundary visible. Automatic multi-cell
paste also offers an exact single-cell alternative at the original selection.
The native modal dialog keeps keyboard focus inside, with a visible close and
application/footer controls at small widths, following the [W3C dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
The unapplied source is not persistent or synchronized across devices. Model
checks: `node tests/table-paste-model.mjs`; real HTTPS browser acceptance is
recorded separately from parser/model checks. CSV file upload/export, embedded
table editing and every external spreadsheet dialect remain separate work.

Each table cell can open its original embedded notes separately, with at most
12 numbered choices per page. Identical titles or legacy duplicate note IDs
remain distinct by original position and exact original payload. Edit authored
title, body, supplement and annotation; apply ten Markdown formatting controls
to selected body text, or use Ctrl+B/Ctrl+I. HTML and image references stay
inert in preview. Choose seven colours/custom hex, plain/lined/grid paper and
10–40 font size. The desktop preview stays beside scrolled colour controls;
narrow screens use one column with visible 44px exits and actions.

Changes stay separate from the document until explicit Apply (Ctrl+S inside
this dialog applies that note). Closing retains input, selection and raw
invalid colour in this page; Resume returns to the captured original target.
These unsubmitted inputs are **not** persisted across a completed reload or
another device. Before leaving, apply or export them. Export includes the
captured original full board with the pending note patch; invalid raw settings
are retained in separate `unappliedCellNoteForm` metadata. This is an original
input export, not automatic replay or a merged copy of later board changes.

Apply preserves original IDs, manual sizes, file/time/image references and
unknown fields, and uses ordinary scoped board saving/undo. Legacy absent
axis IDs remain absent. Changing/removing the target, undo-replacing the
original table or losing edit permission freezes the separate input while
retaining export; it never redirects to a neighboring cell. Unsupported
original text structures refuse editing without coercion. Blank embedded
notes contain no authored copy and use the auto-size default, while existing
manual dimensions remain exact. Embedded media editing/playback, nested
table editing, cross-board note references and real-time merging remain
unfinished. Checks: `node tests/cell-notes-model.mjs`.

The account-scoped **Versions and space** panel now lets workspace owners
review older board versions before permanently removing them. Select how
many newest versions to retain, then inspect the exact retained/removed
version IDs, names, dates and payload-byte totals. A separate trash review
can permanently remove one inspected deleted board and its history. These
operations require a new explicit acknowledgement and confirmation each
time. Editors/readers can inspect/export accessible versions, but cannot
use the permanent-removal controls.

The preview is bound to the original account/workspace/board and a server
plan ETag. Confirmation rechecks ownership and the complete plan; the
server checks it again under the same transaction lock used for saves.
A newer save, changed retention choice or restored trash board invalidates
the preview. Closing before the write invalidates approval; closing after
the write was sent cannot undo it. Interrupted or malformed replies are
unconfirmed and never automatically retried. Current documents, current
page input, member-private conflict submissions and original media files
are preserved. A permanently removed board key remains reserved, preventing
old tabs from resurrecting it. The displayed reduction measures content
payloads, not free filesystem space.

The dialog separates retained/removed versions, bounds long lists, and
offers visible Cancel/Close actions. Initial focus uses Cancel when content
fits, or the heading when scrolling would hide the target/warning. These
choices follow the [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
and [alert dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/);
this is not an accessibility certification. Checks:
`node tests/cleanup-plan.mjs` and `python manage.py test core.test_cleanup`.
The same panel can now remove one inspected **own server conflict
submission** after explicit acknowledgement. Viewing it, exporting it or
choosing Keep sends no removal. Before the write, the original account and
workspace and the complete immutable submission are checked again. Closing
before that check finishes cancels the write; closing after it was sent
cannot reverse it. The server allows an active owner/editor to remove only
their own exact submission UUID. Readers can inspect/export their own
submissions, but cannot remove them. Responses identify the removed UUID;
an interrupted, malformed or mismatched response is never retried
automatically and asks the user to refresh. An already inspected raw copy
remains exportable, even when the account changes or the list cannot be
checked. This does not clear browser drafts, replace current documents,
remove retained versions or delete any original media file.

An active owner/editor can also inspect and explicitly **take back a retained
board version**. The comparison shows the exact current and selected authored
content; neither opening it nor choosing Keep writes anything. Confirmation
uses a server plan ETag binding the original workspace/board/source revision,
current board and retained-version set. The server repeats the complete check
under the workspace lock used for saves, membership changes and cleanup. A
newer save, removed source, changed plan or lost permission refuses the write.
Successful application adds one current revision, retaining every previously
kept revision and all author-private conflict inputs. It never replaces the
editing page's unsubmitted text. Verification opens separately; another save
after an accepted application is reported as a changed current state, without
another overwrite. Unknown fields, manual layout, authored links and original
file references remain exact. An identical payload makes no new revision.

If the retained-version count or content quota is full, or the historical
folder no longer exists, application is blocked with a concrete explanation;
it does not silently prune history or change the original folder. The current
and selected version can still be exported/inspected. An interrupted or
mismatched post-write reply is unconfirmed and never automatically retried.
Checks: `python manage.py test core.test_revision_application` and
`node tests/revision-application.mjs`. This introduces no new storage schema.

The existing Versions and space panel also provides **classification catalog**
and **library catalog** history. Choose the saved-content type; catalogs keep
their fixed `catalog` key but distinct `folders`/`library` endpoint types.
The original account/workspace binding, complete plan check and owner-only
transactional cleanup apply to both. Owners can first inspect/export the
exact original JSON and retain/remove lists, then explicitly discard older
versions. Authored catalog names appear as plain text in a labeled excerpt,
with the full original JSON still available. Keeping all versions produces
no enabled removal. A catalog that
has never been saved is shown as having no saved record.

Current catalog values and stable folder IDs, board placement, registered
media and original file bytes, member-private submissions and current-page
input remain unchanged. Catalog versions cannot use the board version
application or trash-purge actions. Editors/readers can inspect/export
accessible history but cannot permanently clean it. Account changes,
unexpected catalog types, unavailable fresh checks and later saves invalidate
approval; uncertain write replies never cause an automatic retry. This
controls retained catalog history, not media-file lifecycle cleanup.
Checks: `python manage.py test core.test_catalog_history` and
`node tests/catalog-history-plan.mjs`.

Safe registered file lifecycle cleanup and real-time collaborative merging
are unfinished.
This remains staged, unreleased and undeployed.

The existing cell-content panel now includes read-only **embedded media**
inspection for registered `cellItems` image nodes and `cellImages` references.
The registered MIME type chooses image, native audio/video, or download-only
display. Arbitrary URLs and legacy paths never become media sources. Viewing
adds no board mutation or attachment conversion; the original collections,
manual dimensions, opaque fields and authored cell text are preserved.
Returning, closing, changing the original target or losing readable state
stops playback and clears sources/download targets. Native players do not
autoplay. A pending embedded-note draft remains the first item to resume.

The source is tied to the original account/workspace and exact table, axis,
collection, position and complete original item. Identity is rechecked before
and after metadata reads, and before download; closed or superseded requests
cannot revive an old preview. Unknown image-grid shapes remain untouched and
do not prevent inspection of the separate known note collection. Checks:
`node tests/cell-media-model.mjs`, `node tests/cell-notes-model.mjs` and the
explicit portal-asset test. The corrected, complete local HTTPS suite now
passes 13 groups with the actual editor and backend: original images/downloads,
explicit native audio and stop-on-exit, download-only active HTML, refused
cross-workspace UUIDs, unchanged board/version/history data, superseded/closed
requests, failed/wrong metadata, preserved pending note input, 390px layout,
actual viewer/removal and account-switch protection. Temporary service and
browser are closed afterward. Native video/target-change checks also passed
offline; the registered WebM/VP8 video path has since passed actual localhost
HTTPS playback, pause, range and complete-download checks. The local
certificate is deliberately ignored by the test browser, so this does not
accept a public certificate, real device or collaboration. Embedded media
editing/extraction and complete lifecycle/real-device validation remain
unfinished.

The cell-media controls now retain keyboard continuity: opening focuses Back,
and returning focuses the exact reviewed collection item after it is rendered
again. A changed or unreadable target falls back to Close instead of a different
item. Original note editing does not inherit the media scroll mode. Narrow
screens place the existing download/recheck controls in one fixed bottom row,
and scroll padding keeps focused controls clear of the header/footer. This is
guided by [W3C's explanation of focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html),
not a claim of whole-product accessibility conformance.

Seven focused actual HTTPS groups use the original editor and backend with
synthetic data: exact pre-edit source reproduces the clipped initial download
and lost focus; 390px image actions and Back/Enter continuity improve afterward;
native registered portrait video decodes and plays only explicitly, range and
full downloads preserve exact bytes; 320px short-window video focus clears
the fixed controls; note draft resumption, foreign-workspace refusal and actual
viewer withdrawal retain their protections. All original stored document/media/
history/private-draft rows, quota and file hashes remain unchanged. Four actual
before/after/video images were inspected. This checks one browser and codec;
actual devices and other codec acceptance remain unfinished. Test service and
browser are closed. The media bytes are a test-only canvas recording using
[MediaRecorder](https://www.w3.org/TR/mediastream-recording/#mediarecorder-api),
not captured screens or user footage. The work remains staged and unreleased.

### Server-operator account recovery (staged)

When a user has forgotten their password, a trusted **server administrator**
can recover one exact active account after independently verifying the person's
request. A workspace owner/member does not gain this capability through the
web interface. The login page provides collapsed guidance explaining this
route; invited registration hides it. No public reset endpoint, anonymous
email lookup, mail service or recovery link is introduced.

Run from the configured hosted project/store on the trusted server:

```sh
python manage.py recover_account --account-id 12 --email member@example.test --review-only
python manage.py recover_account --account-id 12 --email member@example.test
```

Use the actual reviewed account ID and email. The first command only displays
identity and the bounded session count. The second requires typing that exact
ID, then entering the new password twice in hidden prompts. Never pass
passwords as command arguments, put them in logs, or treat knowledge of an
email address as proof of ownership. Operator guidance and names are displayed
without terminal escape/line/bidi injection; stored authored names are not
rewritten.

Recovery rechecks the exact account, password state and session set after
acquiring the same account write lock used for password changes. Changed
identity or logins invalidate the review. Password validation, password update
and deletion of that account's login records occur in one transaction; a
failure rolls them back together. Disabled accounts are not reactivated,
privileges and membership are not changed, and workspaces, boards, retained
versions, private conflict submissions and media files are not reset. The
password change invalidates old session authentication hashes, consistent with
[Django's authentication documentation](https://docs.djangoproject.com/en/5.2/topics/auth/default/#session-invalidation-on-password-change).
The new password follows the configured
[Django password validators](https://docs.djangoproject.com/en/5.2/topics/auth/passwords/#password-validation).

Checks: `python manage.py test core.test_account_recovery` includes exact
identity, read-only/cancel behavior, old/new login access, retained work,
rollback, stale plans, terminal-safe names and two concurrent races. A fresh
production-settings interactive CLI check also exercised hidden input,
Argon2, new-password login and unchanged original media bytes. Login guidance
was checked in an offline rendered-template browser; that simulated session
is not a fresh HTTPS or real-device acceptance check. Self-service email
recovery and deployment remain unfinished. This adds no storage schema and
remains unreleased and undeployed.

### Find saved text in the current workspace (staged)

The existing workspace board shelf now has a literal search field. It searches
current, active boards in that URL's original workspace: board names, supported
node title/body/original-text/annotation/name fields, table headings/cells and
nested `cellItems`, plus authored edge labels. One result per board shows its
original name, saved position/context and a bounded plain-text excerpt. Links
open the original board in a new page; they do not replace a page being edited.
Markdown and HTML snippets are text, never executed or rewritten. Case-insensitive
matching retains the author's original characters, including casefold expansions.

`GET /w/<uuid>/api/search?q=...` requires a current membership and the original
`X-Creative-Account` header, including for viewers. It has no write path or file
server fallback. Trash, history, everyone's private conflict drafts, browser
input, unknown extension fields and media file contents are excluded. No
cross-workspace/private-path or external-network lookup is performed.

The read transaction checks record/byte limits before deserializing JSON: at
most 500 boards, 8 MiB of documents, 100,000 traversal parts, 40 results and a
1.2-second cooperative scan deadline. Excerpts use at most 140 original Unicode
characters plus ellipses. A large saved field may take its own bounded processing
time before the next deadline check; this is not a real-time CPU guarantee.
Limit exhaustion returns `coverage: limited`, never an exhaustive absence
claim. Only supported text is covered even when the scan finishes. No search
index, schema, storage or new backup component is introduced. Before public
deployment, configure proxy/application access logging so search query strings
are not recorded as user content; no production logging or remote service
configuration was changed here.

The page clears delayed results when the query changes, is cleared, or the
portal pauses. Results appear only after another original-account workspace
access check; returning to the page rechecks access, keeping the query and other
form input. Refresh invalidates the old search. Offline/invalid replies do not
create links or retry automatically. Enter submits and Escape/clear returns to
the shelf. A read-only search is excluded from unsaved-work warnings; native
checkbox/radio changes use their actual checked state, fixing a false warning
caused by an unchecked account-confirmation box.

Checks: `core.test_workspace_search` covers original data/ETags/usage, server
identity/membership/revocation, excluded private/stale content, nested cells,
literal/Unicode matching and all budgets. The rendered-template browser check
uses actual synthetic Django search replies but simulated in-memory transport;
it includes delayed replies, fresh access, bad replies, offline retry, retained
input, and 390/320px operation. This is not fresh HTTPS, real-device or deployment
acceptance. The visual choices use contextual recognition, quiet status and
clear exits from [NN/g's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/),
judged against actual generic before/after layout and operation rather than a
certification. The pre-change layout image is a same-data reconstruction with
the new controls removed. Hosted search remains unreleased and undeployed;
the unrelated localhost HTTPS media integration still awaits explicit approval.

### Browser-local paper reading (staged)

The existing spatial editor's Reading button offers Original, Clear, Book and
Monospace families for top-level note titles/body/context/annotations and their
existing inspector fields. Original remains the default; code, controls, author
text/font sizes/positions and manual dimensions stay unchanged. Automatic paper
display reflows locally; connectors and Fit use its displayed height instead of
the older stored height. Choosing a reading style does not save a board, create
history or store a font field in its JSON. Subsequent author edits and their
ordinary automatic sizing still follow the existing guarded save flow.

Preferences contain only a fixed font ID and use the page's original numeric
account plus fixed workspace UUID in the browser storage key. Different accounts
and workspaces do not share the choice, while the same account/workspace's other
tabs can receive it. This is neither a synchronized preference nor an authored
per-note font. Fixed local [CSS font fallbacks](https://www.w3.org/TR/css-fonts-4/#font-family-prop)
need no font download; actual glyphs depend on the device. Invalid values fall
back to Original. Storage refusal explicitly leaves a preview, and reopening
uses the previous saved choice. Restore returns to the opening choice.

The same Reading button moves beside the inspector heading in small windows.
The native dialog blocks background save/undo/dismiss commands and returns to
the unchanged original field/caret/selection/view. New account or access loss
closes and disables the old dialog. Own-tab preference notifications defer font
changes and paper rebuilding during a captured pointer gesture or composition; changing only a
reading preference never modifies another author's content.

Final original-page acceptance passed twelve distinct real localhost HTTPS
behavior groups in one uninterrupted synthetic fixture, with earlier focused
checks of the receiving tab's keyboard focus:
four choices, rendering/manual originals/code, exact editor return, persistence
and own-tab focus, malformed values, storage refusal, 390/320px controls, a real
viewer, displayed-height connectors/Fit, switching to another actual member,
native pointer drag/save/own Undo, and simulated composition.
Simulation is not physical-device/IME acceptance;
the test browser's local certificate exception is not public TLS acceptance.
Three pure identity/fallback model cases and twelve affected portal boundaries
also passed. No schema, server backup format, private program or deployment is
changed by this feature.

### Registered HTML static preview (staged)

The existing library detail can display the static layout of a registered
UTF-8 `.html`/`.htm` attachment up to 512 KiB. Its original media URL continues
to return the unchanged download attachment with the restrictive API policy.
There is no arbitrary URL/path reader or unsanitized inline-file fallback.
Plan and view endpoints both check the original account, URL workspace and
membership. The file's length and SHA-256 are verified, supported markup is
filtered, and access is checked again before returning a response. The view
URL binds both original content and rendered hashes; a changed plan is refused.

The ephemeral renderer keeps supported authored text/tables and inline layout
CSS. It drops author scripts, event handlers, links/actions, refresh/base,
embedded documents and foreign namespaces; controls are disabled. Inline
raster images need a matching base64 raster prefix. Other content is omitted,
with an explicit notice and an original-file download. CSS/resource requests
are restricted by the response policy. It is a static subset, not a browser
for arbitrary pages, a complete HTML import, or an author-script execution mode.

Only this dedicated response permits framing by its own origin and inline
layout CSS. The editor permits self-origin frames; login, account APIs and
original media responses keep their previous restrictions. The preview uses
an opaque sandbox without `allow-same-origin`. Exactly one application-owned
Escape listener is admitted by a SHA-256 script CSP hash. It sends only a
constant close request, never document text/account data. The parent requires
the current frame's window, opaque origin, message type and current preview
generation; removing the frame also removes the listener. Authored scripts
remain filtered and arbitrary injected scripts are blocked. This follows the
[HTML sandbox boundary](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)
and [cross-document message checks](https://html.spec.whatwg.org/multipage/web-messaging.html#security-9),
with the hash/response policy defined in [CSP3](https://www.w3.org/TR/CSP3/)
(a working draft), and verified in the actual test browser.

The preview has no persistent derivative files or schema/backup changes. Limits
also bound generated output to 1 MiB, parser callbacks to 10,000, and parsing
to a cooperative 0.5-second deadline. These are not a CPU/paint-time guarantee.
Unsupported encoding, oversized content, bad bytes, revoked access and stale
hashes produce a refusal while preserving the original attachment.

The actual library clears a frame on close, selection/read-state change and
late/invalid results. Fast close/reopen ignores an old queued close event;
another asset cannot replace the active preview. HTML has no extra clipped
outer scrolling container, leaving the explanation, document and original
download accessible at 390px. Escape works inside the focused preview as
well as the outer panel; other windows cannot issue its close request.

Checks: 12 new backend cases plus 14 related media API and 12 portal cases,
and 9 final native-browser component flows plus a separate opaque-window exit
guard check. The latter use the real editor
template, media modules and actual Django response bodies/headers routed
entirely in memory at a synthetic origin. They test enforced CSP/origin
isolation, author-script/resource refusal, Escape, stale/closed targets,
wrong URLs/offline replies, parent input and related native audio cleanup.
This is not real HTTPS, server cookies, certificate validation, whole-canvas
save integration or device acceptance. It remains unreleased and undeployed;
the separate cell-media localhost test has since been explicitly authorized
and its complete corrected 13-group suite passes, as recorded above.

### Registered material lookup (staged)

The existing editor library now searches this workspace's registered file
names, display titles, notes and tags. Enter submits a literal, Unicode-aware
query; result cards show an original-text clue and lead to the same metadata,
download and explicit board insertion controls. Clear restores the original
paged list. Source files are not read or sent to an AI service for this search;
folders, board text, history and private drafts are outside its search fields.

`GET/HEAD /w/<workspace>/api/assets/search?q=...` requires the original page
account header and scoped membership, with fresh account/membership checks
before and after scanning. Only one query parameter is accepted. Read budgets
limit the scan to 500 registered items, 8 MiB of metadata/catalog data before
deserializing, 100,000 field steps, 40 results and a cooperative 1.2-second
deadline. Partial coverage is reported explicitly; narrowing a query cannot
guarantee coverage of older items outside the scan budget. Clearing search
still permits normal paged browsing. This adds no index, derivative storage,
schema migration or backup data. Deployment access logs must omit query strings.

The panel drops stale actions during reads and refuses changed identities,
duplicate/invalid replies and late results after another query, Clear or close.
Search does not discard a chosen local file, unsaved metadata or note input.
Narrow-screen results use one column for legible clues; refreshing a selected
result no longer scrolls away from the query, and keyboard focus stays below
the fixed close header. Existing media/HTML preview operations retain their
explicit exit and original download.

Design rationale: original context helps people recognize a saved item rather
than remember an exact filename ([NN/G: recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/)).
Visible read/failure/partial states help people interpret the result's limits
([NN/G: visibility of system status](https://www.nngroup.com/articles/visibility-system-status/)).
These principles informed the controls; synthetic real-operation screenshots
were used to check the actual layout and focus behavior.

Checks: 9 new backend cases plus 14 related media API and 12 portal cases;
11 native-browser component groups, followed by 2 focused layout/input groups
and a final affected scroll group. These overlap, rather than constituting
14 distinct scenarios. Four affected HTML/native-audio component groups also
pass. All browser responses were actual Django payloads routed in memory at a
synthetic origin, using the original template and actual library modules. They
are not real TLS/cookie, full-canvas save, actual-device or remote acceptance.
The work remains unreleased and undeployed.

### Offline media inventory (staged, read only)

After stopping every hosted worker, a trusted server operator can run:

```text
python manage.py audit_media --service-stopped
```

The command acquires the existing exclusive storage lease and classifies direct
entries in known workspace `media` and `incoming` areas: registered files,
registered size mismatches, reserved uploads, unregistered files, misplaced
identities, unknown entries and unsafe links/types. It does not read blob
contents or any authored document/history/private-submission text. Unknown
directories, workspace directories and link targets are not traversed.
Original names, notes, account details and absolute paths are absent from the
report; unusual names receive an opaque keyed entry token. This token is not a
cleanup plan. There is no deletion, repair, re-registration or apply option.

The command uses fresh no-follow metadata instead of cached directory-entry
stat values ([Python filesystem APIs](https://docs.python.org/3.12/library/os.html#os.DirEntry.stat)),
including Windows reparse attributes ([Python stat attributes](https://docs.python.org/3.12/library/stat.html#stat.FILE_ATTRIBUTE_REPARSE_POINT)).
It checks observed file/directory metadata and the minimal registration
snapshot again before a complete result. Changed or inaccessible entries fail
without modifying application data. Record/entry/time limits and omitted
findings are explicit. `enumerationComplete` covers only the direct known
storage entries; `uninspectedSubtrees` reports skipped targets. A registered
filename and matching size do not prove content integrity, and an unregistered
file does not prove absence of references. Every report and finding has
`deletionSafe: false`; other members' private references are never examined.

Registered originals are now reconciled against completed direct-directory
listings, so an absent original produces `registeredMissing` without deleting
its registration or pretending that an empty report is healthy. Missing known
media/workspace/storage directories are distinguished from an unsafe or
uninspected ancestor: the latter produces `registeredUninspected`, not absence.
Derived registered paths are neither opened nor statted through skipped links.
An unsafe original file, including a hardlinked or nonregular entry, also
remains uninspected. `registeredFilesChecked` and
`registeredPresenceCoverageComplete` describe this presence check only, with
the same record/entry/time/detail limits. Original-content hashes and reference
safety are still outside this command. A file added during the check causes
the changed-directory verification to refuse a report instead of accepting a
stale missing finding. A same-ID copy in another workspace cannot conceal the
missing original in its registered workspace.
If the registration pass runs out of budget before that final verification,
its absence conclusions and their hidden-detail counts are discarded; earlier
bounded entry inventory is explicitly incomplete.

The existing lease may create its persistent coordination file if absent;
application files and database records are not changed. The lease coordinates
cooperating hosted processes, not arbitrary administrative filesystem writers.
Native Windows/Linux path and locking acceptance remains required before
deployment. A complete backup remains a separate operation.

Local checks: all 21 affected cases pass, including seven registered-presence
regressions and actual native Windows hardlink/junction refusal checks. Earlier
sandbox-only link skips were resolved using the same isolated fixtures with
permission to create native test links. An actual separate-process audit is
refused while a runtime lease is held. Three actual production-settings CLI
groups on an independent synthetic store check a missing registered original,
a real hardlinked registered original, classification/redaction, missing
confirmation/unknown deletion arguments and unchanged database, all model rows,
quota and every retained file hash. No hosted browser or public endpoint is
added, and no schema or backup format changes are needed. This is draft
development code; it remains unmerged and undeployed.
