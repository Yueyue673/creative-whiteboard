# Verified official multi-platform Python manifest; refresh deliberately.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 \
    DJANGO_SETTINGS_MODULE=service.settings
RUN groupadd --gid 10001 creative && useradd --uid 10001 --gid 10001 --no-create-home creative
WORKDIR /opt/creative
COPY hosted/requirements*.txt /opt/creative/hosted/
RUN pip install --no-cache-dir -r hosted/requirements-runtime.txt
COPY board_schema.py library_folders.py LICENSE /opt/creative/
COPY vendor/markdown-it.min.js vendor/markdown-it.LICENSE /opt/creative/vendor/
COPY hosted /opt/creative/hosted/
USER 10001:10001
WORKDIR /opt/creative/hosted
EXPOSE 8000
ENTRYPOINT ["python", "deployment/entry.py"]
CMD ["serve"]
