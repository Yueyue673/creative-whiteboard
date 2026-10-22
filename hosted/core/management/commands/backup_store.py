import json
import sqlite3

from django.core.management.base import BaseCommand, CommandError

from core.backups import backup_store
from core.maintenance import StorageLease
from core.services import APIError


class Command(BaseCommand):
    help = "Stop hosted workers and snapshot SQLite plus all current workspace files into a NEW external directory."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--service-stopped", action="store_true")
        parser.add_argument("--destination", required=True)

    def handle(self, *args, **options):
        if not options["service_stopped"]:
            raise CommandError("先停止全部网页服务，再传入 --service-stopped；这不是运行中的完整备份")
        try:
            with StorageLease(offline=True) as lease:
                result = backup_store(lease, options["destination"])
        except (APIError, OSError, sqlite3.Error) as error:
            message = error.message if isinstance(error, APIError) else "备份存储或数据库操作失败"
            raise CommandError(message + "。原数据未被清理；若已创建副本，未完成标记会保留，不能拿它恢复。") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
