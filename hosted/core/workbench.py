"""Serve the actual desktop workbench against fixed hosted account/workspace APIs.

Only reviewed public program files are read here. This module never imports the
desktop server, selects a filesystem workspace or serves a user supplied path.
"""
import json
import re
import secrets
from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Membership
from .scope import valid_membership
from .views import account_json

PROGRAM_FILES = frozenset(json.loads((Path(__file__).resolve().parents[1] / 'deployment/native_files.json').read_text())['files'])


@ensure_csrf_cookie
def file(request, workspace_id, name='shell.html'):
    if request.method not in ('GET', 'HEAD'):
        return JsonResponse({'error': '工作台程序只支持读取'}, status=405)
    if not request.user.is_authenticated:
        if name in ('shell.html', 'index.html'):
            from .portal import page
            return page(request, workspace_id=workspace_id)
        return JsonResponse({'error': '请先登录'}, status=401)
    member = Membership.objects.select_related('workspace').filter(workspace_id=workspace_id, account=request.user).first()
    if member is None or not valid_membership(member):
        return JsonResponse({'error': '工作区不存在或你没有访问权限'}, status=404)
    identities = request.GET.getlist('account')
    if identities and identities != [str(request.user.pk)]:
        return JsonResponse({'error': '登录账号已改变，原工作台没有切换保存对象，请保留输入后检查登录', 'code': 'account_changed'}, status=409)
    if name == 'hosted-bridge.js':
        path = Path(__file__).resolve().parent / 'portal_assets/hosted-bridge.js'
    elif name in PROGRAM_FILES:
        path = settings.PROGRAM_ROOT / name
    else:
        raise Http404
    if path.resolve() != path.absolute() or not path.is_file():
        raise Http404
    text = path.read_text('utf-8')
    base = f'/w/{workspace_id}/app/'
    bound = f'account={request.user.pk}'
    # Exact legacy navigation prefixes, never request-driven program rewriting.
    for entry in ('index.html', 'shell.html'):
        text = text.replace('/' + entry + '?', base + entry + '?' + bound + '&')
    if name == 'shell.js':
        # The desktop root means its current filesystem workspace. Hosted home
        # means the personal workspace, so preserve this pane's explicit scope.
        text = text.replace("w.location.replace('/?board='+encodeURIComponent(t.boardId))",
                            'w.location.replace(' + json.dumps(base + '?' + bound + '&board=') + '+encodeURIComponent(t.boardId))')
    text = text.replace("const mediaURL=id=>'/api/media/'+encodeURIComponent(id);", 'const mediaURL=id=>window.whiteboardHosted.mediaURL(id);')
    text = text.replace("'/api/preview/'+encodeURIComponent(id)", 'window.whiteboardHosted.previewURL(id)')
    text = text.replace("'/api/preview/'+encodeURIComponent(a.id)", 'window.whiteboardHosted.previewURL(a.id)')
    text = text.replace('网页预览 · 支持页面内的样式与交互', '网页静态预览 · 原文件可以下载')
    text = text.replace('保存白板恢复点', '检查白板自动恢复记录').replace('保存内容库恢复点', '检查内容库自动恢复记录').replace('已保存白板恢复点', '当前云端白板已有恢复记录').replace('已保存内容库恢复点', '当前云端内容库已有恢复记录')
    text = text.replace('已保存到本机', '已保存到云端').replace('内容已保存到本机', '内容已保存到云端').replace('修改正在本机保存', '修改正在云端保存')
    if name.endswith('.html'):
        nonce = secrets.token_urlsafe(24)
        for program in sorted(PROGRAM_FILES, key=len, reverse=True):
            text = text.replace('="/' + program + '"', '="' + base + program + '?' + bound + '"')
        # Vendor is the one existing fixed, reviewed alias.
        text = text.replace('="/vendor/markdown-it.min.js"', '="/portal-assets/markdown-it.js"')
        context = {'account': account_json(request.user), 'workspace': str(workspace_id), 'role': member.role, 'base': f'/w/{workspace_id}/api/', 'app': base}
        encoded = json.dumps(context, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
        prelude = '<script id="hosted-workbench-context" type="application/json">' + encoded + '</script><script src="' + base + 'hosted-bridge.js?' + bound + '"></script>'
        first_script = text.index('<script')
        text = text[:first_script] + prelude + text[first_script:]
        text = re.sub(r'<script(?=[\s>])', '<script nonce="' + nonce + '"', text)
        response = HttpResponse(text, content_type='text/html; charset=utf-8')
        response.creative_workbench_nonce = nonce
        return response
    return HttpResponse(text, content_type='text/css; charset=utf-8' if name.endswith('.css') else 'text/javascript; charset=utf-8')


# This view does its own fresh membership check for program and HTML requests;
# anonymous HTML can show the existing login shell without exposing any content.
file.creative_portal_page = True
