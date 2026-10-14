import json
import sqlite3

from django.core.management.base import BaseCommand, CommandError

from core.backups import verify_backup
from core.services import APIError


class Command(BaseCommand):
    help = "Verify a local backup's complete file scope, exact hashes, SQLite integrity and registered media."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True)

    def handle(self, *args, **options):
        try:
            result = verify_backup(options["source"])
        except (APIError, OSError, sqlite3.Error) as error:
            message = error.message if isinstance(error, APIError) else "备份文件或数据库核对失败"
            raise CommandError(message + "；未写入工作数据。") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
