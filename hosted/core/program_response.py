"""Conditional transfer of reviewed program bytes; never user data or HTML."""
import hashlib

from django.http import HttpResponse


def program_response(request, value, content_type):
    raw = value.encode('utf-8') if isinstance(value, str) else value
    version = '"' + hashlib.sha256(raw).hexdigest() + '"'
    # If-None-Match on reads uses weak comparison, including a proxy's gzip tag.
    response = HttpResponse(status=304) if request.headers.get('If-None-Match') in (version, 'W/' + version) else HttpResponse(raw, content_type=content_type)
    response['ETag'] = version
    response.creative_program_cache = True
    return response
