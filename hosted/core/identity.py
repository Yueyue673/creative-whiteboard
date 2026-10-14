"""Bind account actions to the page which initiated them, not a newer cookie."""
from django.http import JsonResponse

from .services import APIError


def page_account(request):
    identity = request.headers.get("X-Creative-Account", "")
    if not identity:
        raise APIError("缺少页面所属账号，请保留输入并重新打开工作区", 428)
    if identity != str(request.user.pk):
        return JsonResponse({
            "error": "登录账号已改变，请保留这个页面的输入后再重新打开工作区",
            "code": "account_changed", "preserveDraft": True,
        }, status=409)
    return None
