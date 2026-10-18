from django.http import JsonResponse

from .account_security import change_password, locked_account, reauth_throttle, reviewed_logins, revoke_logins
from .views import endpoint, payload


@endpoint(("GET", "HEAD"), signed_in=True, account_bound=True)
def sessions(request):
    with locked_account(request) as (account, current):
        _, rows, tag = reviewed_logins(account, current)
        response = JsonResponse({"sessions": rows})
        response["ETag"] = tag
        return response


@endpoint(("POST",), signed_in=True, account_bound=True)
def password(request):
    data = payload(request, ("oldPassword", "newPassword", "confirmation"))
    reauth_throttle(request)
    return JsonResponse(change_password(request, data["oldPassword"], data["newPassword"], data["confirmation"]))


@endpoint(("POST",), signed_in=True, account_bound=True)
def revoke(request, session_id=None):
    data = payload(request, ("password", "confirm"))
    reauth_throttle(request)
    return JsonResponse(revoke_logins(request, data["password"], data["confirm"], session_id))
