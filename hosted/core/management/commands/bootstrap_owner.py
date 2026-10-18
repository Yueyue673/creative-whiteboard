"""Interactive, local-only creation of the first account; no open signup."""
from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from core.models import Account, Initialization, canonical_email
from core.services import APIError, authored_name, create_personal_workspace


class Command(BaseCommand):
    help = "Create the first hosted account interactively, after migrations."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--name", required=True)

    def handle(self, *args, **options):
        if Account.objects.exists():
            raise CommandError("已有账号，不能再次初始化。其他账号应通过邀请注册。")
        try:
            account = Account(email=canonical_email(options["email"]), display_name=authored_name(options["name"], 80), is_staff=True, is_superuser=True)
            password = getpass("Password: ")
            if password != getpass("Password again: "):
                raise CommandError("两次密码不一致")
            validate_password(password, account)
            account.set_password(password)
            with transaction.atomic():
                Initialization.objects.create(id=1)
                if Account.objects.exists():
                    raise CommandError("账号已经初始化")
                account.save()
                create_personal_workspace(account)
        except (ValidationError, ValueError, APIError) as error:
            raise CommandError(str(error)) from error
        except IntegrityError as error:
            raise CommandError("账号已经初始化") from error
        self.stdout.write("首个账号已创建。密码不会写入日志。")
