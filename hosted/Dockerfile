# Verified official multi-platform Python manifest; refresh deliberately.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 \
    DJANGO_SETTINGS_MODULE=service.settings
RUN groupadd --gid 10001 creative && useradd --uid 10001 --gid 10001 --no-create-home creative
WORKDIR /opt/creative
COPY hosted/requirements*.txt /opt/creative/hosted/
RUN pip install --no-cache-dir -r hosted/requirements-runtime.txt
COPY board_schema.py library_folders.py LICENSE /opt/creative/
COPY ai-workflow.js appearance.js autosize.js board-lifecycle.js cells.js clipboard-coordinator.js context-capture.js document-loading.js experience.js explorer-navigation.js import-session.js index.html library-clipboard.js library-editing.js library-folders.js library-transfer.js media-controls.js media-markers.js navigation.js note-editor.css note-editor.js pane.js preview-pan.js recovery.js refinement.css refinement.js shell.css shell.html shell.js theme.css theme.js workflow.css workflow.js workspace-shell.css workspace-shell.js workspace.css workspace.js /opt/creative/
COPY vendor/markdown-it.min.js vendor/markdown-it.LICENSE /opt/creative/vendor/
COPY hosted /opt/creative/hosted/
USER 10001:10001
WORKDIR /opt/creative/hosted
EXPOSE 8000
ENTRYPOINT ["python", "deployment/entry.py"]
CMD ["serve"]
