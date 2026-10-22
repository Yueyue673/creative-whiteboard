"""Explicit offline initialization; serving never migrates or creates accounts."""
import argparse
import os
import stat
import sys
from pathlib import Path

HOSTED_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HOSTED_ROOT))
os.environ["DJANGO_SETTINGS_MODULE"] = "service.settings"


def ready_store():
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from core.maintenance import StorageLease
    from django.core.management.base import CommandError
    database = Path(settings.DATABASES["default"]["NAME"])
    try:
        details = database.lstat()
        if database.resolve() != database or not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
            raise ValueError()
    except (OSError, ValueError):
        raise CommandError("Hosted database must be initialized in the selected store before serving.") from None
    with StorageLease():
        try:
            executor = MigrationExecutor(connection)
            if executor.migration_plan(executor.loader.graph.leaf_nodes()):
                raise CommandError("Stop all hosted workers and explicitly migrate this store before serving.")
        finally:
            connection.close()


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("serve", "migrate", "check"):
        sub.add_parser(action)
    bootstrap = sub.add_parser("bootstrap-owner")
    bootstrap.add_argument("--email", required=True)
    bootstrap.add_argument("--name", required=True)
    manage = sub.add_parser("manage")
    manage.add_argument("command", choices=("recover_account", "audit_media", "backup_store", "verify_backup", "restore_store", "reconcile_uploads"))
    manage.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.action == "manage":
        # These commands already own their exact offline leases/confirmations.
        os.execv(sys.executable, [sys.executable, str(HOSTED_ROOT / "manage.py"), args.command, *args.arguments])
    if args.action == "serve":
        ready_store()
        os.chdir(HOSTED_ROOT)
        os.execv(sys.executable, [sys.executable, "-m", "gunicorn", "--config", str(HOSTED_ROOT / "deployment/gunicorn_conf.py"), "service.wsgi:application"])
    import django
    django.setup()
    from django.core.management import call_command
    from core.maintenance import StorageLease
    if args.action == "check":
        call_command("check", deploy=True, fail_level="ERROR")
    else:
        with StorageLease(offline=True):
            if args.action == "migrate":
                call_command("migrate", interactive=False)
            else:
                call_command("bootstrap_owner", email=args.email, name=args.name)


if __name__ == "__main__":
    from django.core.exceptions import ImproperlyConfigured
    from django.core.management.base import CommandError
    try:
        main()
    except (ImproperlyConfigured, CommandError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except Exception as error:
        from django.apps import apps
        message = "Hosted command failed; storage was not automatically removed or restored."
        if apps.ready:
            from core.services import APIError
            if isinstance(error, APIError):
                message = error.message
        print(message, file=sys.stderr)
        raise SystemExit(1) from None
