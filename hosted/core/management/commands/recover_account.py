"""Interactive recovery by a trusted server operator, after identity review."""
from getpass import getpass
import json
import unicodedata

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from core.account_recovery import apply_recovery, review_recovery
from core.services import APIError


def console_name(value):
    # A self-authored name must not inject terminal lines, escapes or bidi
    # controls into the operator's identity review. Preserve stored text.
    text = json.dumps(value, ensure_ascii=False)
    return "".join(f"\\u{ord(char):04x}" if unicodedata.category(char) in ("Cf", "Zl", "Zp") else char for char in text)


class Command(BaseCommand):
    help = "Review one exact account, then recover its password interactively; requires trusted server access."

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int, required=True)
        parser.add_argument("--email", required=True)
        parser.add_argument("--review-only", action="store_true")

    def handle(self, *args, **options):
        try:
            plan, tag = review_recovery(options["account_id"], options["email"])
            self.stdout.write(f"账号编号：{plan['accountId']}\n邮箱：{plan['email']}\n名称：{console_name(plan['name'])}")
            self.stdout.write(f"将退出这个账号的 {plan['sessionsToRevoke']} 条登录记录，其中未到期 {plan['unexpiredSessions']} 条。")
            self.stdout.write("白板、素材、私有输入、成员关系及权限保留。仅限可信服务器管理员，在核实本人请求后使用。")
            if options["review_only"]:
                self.stdout.write("仅查看，账号和登录记录没有改变。")
                return
            confirmation = input("核对后，输入上方完整账号编号确认（回车取消）：").strip()
            if confirmation != str(plan["accountId"]):
                raise CommandError("已取消恢复，账号和登录记录保持原样。")
            password = getpass("新密码（隐藏输入）：")
            repeated = getpass("再次输入新密码（隐藏输入）：")
            result = apply_recovery(plan["accountId"], plan["email"], tag, confirmation, password, repeated)
        except (EOFError, KeyboardInterrupt):
            raise CommandError("已取消恢复，账号和登录记录保持原样。") from None
        except ValidationError as error:
            raise CommandError("新密码不符合当前密码规则，未更改账号和登录记录。") from error
        except (APIError, ValueError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(f"账号 {result['accountId']} 的密码已恢复，旧登录已退出。请本人使用新密码重新登录；原工作数据和权限保留。")
