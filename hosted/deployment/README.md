# Independent hosted development deployment

This is a **development package**, not authorization to deploy and not a completed
web product. Account ownership and scoped invitations are implemented; real-time
merge, full device acceptance, registered-file lifecycle controls, external DNS
and certificate acceptance remain unfinished. It never imports desktop data.

The image uses the reviewed Python manifest digest and Gunicorn 26.2.0. Its exact
115 runtime files are declared in `program_files.json` and mirrored by literal
file exceptions in `.dockerignore`. Do not unignore parent directories: their
children can become build inputs too. The contract includes current portal
assets and migrations, while excluding desktop `server.py`, local data, keys,
logs, caches, screenshots and tests. Future runtime additions must update both
lists; `core.test_program_context` checks current asset/module/migration coverage.

`program_context.export_context` copies only those explicit public files and the
three build controls to a new empty directory outside the source checkout. It
does not walk unlisted files, overwrite a target or follow linked program inputs.
Use a reviewed clean fixed-revision source; a manifest is not a content signature
or a substitute for source review. Operator environment and secret files remain
outside the checkout and any exported context. The context rule follows
[Docker's build-context and ignore semantics](https://docs.docker.com/build/concepts/context/).

The default application has one guarded WSGI worker and two threads, a 768 MiB
memory limit, 0.75 CPU limit and a loopback-only published port. These are a small
preview starting point, **not a measured capacity guarantee**. No migration,
account creation, backup, restore or deletion occurs when serving starts.

## Operator preparation

Use independent existing data, backup and configuration paths outside the
checkout. They must be real directories, not links into another project.
Copy `environment.example` to an operator-only file **outside the checkout**,
replace every placeholder, and keep its hostname exact. Prepare the data and
backup directories for UID/GID `10001:10001`, mode `0700`. The secret file must
be readable by that UID, mode `0400`; Compose bind-backed secrets do not remap
host ownership. Never commit these files or change an existing deployment key.

Create a **new** random key outside the checkout using an exclusive file open:

```python
from pathlib import Path
from secrets import token_urlsafe
path = Path('/absolute/path/to/private-config/hosted.key')
with path.open('x', encoding='utf-8') as output:
    output.write(token_urlsafe(48) + '\n')
path.chmod(0o400)
```

Set only `CREATIVE_BOARD_HOSTED_SECRET_FILE` through the Compose secret. A
simultaneous environment key is rejected. A missing, linked, oversized, changed,
short or malformed secret fails without echoing its value or private path.
Keep the original key separately for trusted recovery; it is not in a backup.

With an operator-selected private environment file, the explicit sequence is:

```sh
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment --profile operations build app
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment --profile operations run --rm ops check
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment --profile operations run --rm ops migrate
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment --profile operations run --rm ops bootstrap-owner --email your-chosen-email --name your-chosen-name
```

The last command prompts privately for a password. Do not pass passwords on a
command line. Initialization is single-use; other users register through an
email-bound invitation, not open signup. Both migration and first-account setup
require an exclusive offline lease and refuse while guarded workers are active.
Serving refuses an uninitialized or outdated schema and incomplete restoration.

Only after release checks and explicit deployment approval should the operator
start `app`. `nginx.example.conf` is a separate site example, not a replacement
for existing services. Obtain a valid certificate for the chosen hostname first,
validate the configuration, overwrite forwarding headers, and retain the
backend loopback boundary. This package does not issue certificates or configure
DNS. Container health checks exercise the protected backend policy locally;
they do not validate external HTTPS or prove multi-device collaboration.

HTTP access logging is off by default, request/security diagnostics are omitted,
and the example proxy does not log request paths or query strings. Gunicorn
runtime warnings/errors are generic; use the offline `check` command for
configuration diagnostics. Other upstream proxies, host logging and monitoring
must also be reviewed by the operator before launch. No browser headers,
passwords, search queries or invitation tokens belong in a public log/artifact.

## Backup and recovery

Stop `app` and every other guarded worker/supervisor for this store. Do not use
`down -v`, remove lock files, or clean incomplete restore markers. Existing
maintenance commands still require their confirmations and exact review hash.

```sh
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment stop app
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment --profile operations run --rm ops manage backup_store --service-stopped --destination /backups/new-snapshot
docker compose -f hosted/compose.yaml --env-file /absolute/private/environment --profile operations run --rm ops manage verify_backup --source /backups/new-snapshot
```

For restoration, make a **different empty data directory**, select it in a
separate private environment file and retain the original store. Do not migrate
or initialize that empty target first. Use the independently reviewed
`manifestHash` from verification:

```sh
docker compose -f hosted/compose.yaml --env-file /absolute/private/recovery-environment --profile operations run --rm ops manage restore_store --service-stopped --source /backups/new-snapshot --manifest-hash reviewed-hash --confirm-restore-new-store
```

Review recovered account access before starting the new store. Offsite,
encrypted, scheduled backups and a measured restore objective are still operator
work; same-machine files alone are not an offsite backup. This is an offline
snapshot of the implemented account/workspace/media/history/draft store, not a
live backup promise or permission to upload personal desktop work.

## Validation scope

`core.test_configuration` and `core.test_deployment` exercise secret-file refusal,
explicit initialization and live-lease/incomplete-restore protection on local
synthetic stores. `core.test_linux_storage` requires an actual Linux kernel for
multiple real WSGI worker leases, last-worker crash release, native links/FIFO,
directory sync and link-free inventory. Windows does not stand in for those.

The Linux development workflow also runs hosted tests, pure browser models and
`container_smoke.py`. That fixture builds the image, resolves Compose, verifies
a local synthetic CA rather than ignoring certificate validation, checks secure
login/CSRF, original board/media/Range and foreign-scope refusal, then restores
a stopped store into a different empty directory. It does not deploy a server,
use private data or establish external certificate/device/realtime acceptance.
The workflow result, not this document, determines whether these checks passed.

Before the application build, actual Docker exports a minimal parent-exception
baseline and an independent full program context to tar inventories. The baseline
uses synthetic extras only; it is not evidence of a private-file exposure. The
corrected context must contain exactly all115 runtime files and omit twelve
unlisted synthetic inputs placed in root/runtime/asset/vendor subdirectories.
The resulting application image is separately inventoried against that same
manifest. The real HTTPS/backup/restore fixture then runs from this independently
exported context, rather than borrowing files from the original checkout.

Sources for the operational mechanics:
[Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/),
[Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/),
[Docker runtime mounts and limits](https://docs.docker.com/engine/containers/run/),
[Gunicorn settings](https://gunicorn.org/reference/settings/).
