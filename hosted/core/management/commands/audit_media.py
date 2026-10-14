"""Trusted operator's read-only inventory, never a deletion plan or HTTP API."""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from core.maintenance import StorageLease
from core.media_audit import audit_media
from core.services import APIError


class Command(BaseCommand):
    help = "Offline read-only inventory of registered, pending and unregistered storage entries. Never deletes files."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--service-stopped", action="store_true")

    def handle(self, *args, **options):
        if not options["service_stopped"]:
            raise CommandError("先停止全部网页服务，再传入 --service-stopped；正在上传时的文件不能当作遗留文件")
        try:
            with StorageLease(offline=True) as lease:
                result = audit_media(lease)
        except (APIError, OSError, DatabaseError) as error:
            message = error.message if isinstance(error, APIError) else "存储或数据库无法盘点"
            raise CommandError(message + "。盘点未清理或更改原数据。") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
