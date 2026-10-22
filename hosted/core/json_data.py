import json


class DocumentJSONEncoder(json.JSONEncoder):
    def __init__(self, *args, **kwargs):
        kwargs.update(ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        super().__init__(*args, **kwargs)


def document_bytes(value):
    return json.dumps(value, cls=DocumentJSONEncoder).encode("utf-8")
