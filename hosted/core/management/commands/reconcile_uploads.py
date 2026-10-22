"""Local, explicitly offline review/confirmation of interrupted upload storage."""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, transaction

from core.maintenance import StorageLease
from core.media import locked_budget
from core.services import APIError
from core.upload_recovery import discard_interrupted_uploads, review_uploads


class Command(BaseCommand):
    help = "Stop all hosted WSGI processes, preview pending uploads, then confirm their exact plan. Never deletes registered assets."

    def add_arguments(self, parser):
        parser.add_argument("--service-stopped", action="store_true", help="Confirm all hosted service processes are stopped; also verified by an OS lock.")
        parser.add_argument("--plan-token", help="Exact planToken from the latest preview of this store.")
        parser.add_argument("--confirm-discard-interrupted-uploads", action="store_true", help="Discard unregistered pending bytes and release their reservations; keep original local files.")

    def handle(self, *args, **options):
        if not options["service_stopped"]:
            raise CommandError("先停止全部网页服务，再传入 --service-stopped；不能仅凭上传较早就删除它")
        if bool(options["plan_token"]) != bool(options["confirm_discard_interrupted_uploads"]):
            raise CommandError("执行清理必须同时提供核对编号与明确的丢弃确认")
        try:
            with StorageLease(offline=True) as lease:
                if options["plan_token"]:
                    result = discard_interrupted_uploads(lease, options["plan_token"])
                else:
                    with transaction.atomic():
                        locked_budget()
                        result = review_uploads(lease)
                    result["notice"] = "仅预览，未删除文件或上传占位；确认后会丢弃未登记的上传内容，请保留原文件。已登记素材保留，未占位文件不在本次范围。"
        except (APIError, OSError, DatabaseError) as error:
            message = error.message if isinstance(error, APIError) else "存储或数据库操作失败"
            raise CommandError(message + "。若清理已开始，未登记的部分文件可能已移除，但上传占位仍计入容量；重新预览后才能重试。") from None
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
