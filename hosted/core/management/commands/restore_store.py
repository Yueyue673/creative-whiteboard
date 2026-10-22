import json
import sqlite3

from django.core.management.base import BaseCommand, CommandError

from core.backups import restore_store
from core.maintenance import StorageLease
from core.services import APIError


class Command(BaseCommand):
    help = "Restore a verified backup only into the configured EMPTY new data store. Never overwrites an existing store."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--service-stopped", action="store_true")
        parser.add_argument("--source", required=True)
        parser.add_argument("--manifest-hash", required=True)
        parser.add_argument("--confirm-restore-new-store", action="store_true")

    def handle(self, *args, **options):
        if not options["service_stopped"] or not options["confirm_restore_new_store"]:
            raise CommandError("先停止全部网页服务，再明确确认恢复到新空目录；不能覆盖原目录")
        try:
            with StorageLease(offline=True) as lease:
                result = restore_store(lease, options["source"], options["manifest_hash"])
        except (APIError, OSError, sqlite3.Error) as error:
            message = error.message if isinstance(error, APIError) else "恢复文件或数据库操作失败"
            raise CommandError(message + "。若复制已开始，未完成标记会阻止网页启动；保留副本供核对，再用新的空目录恢复。") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
