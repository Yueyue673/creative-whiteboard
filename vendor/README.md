# Bundled libraries

These browser libraries are served locally; the app does not request a CDN.

- `html2canvas.min.js`: html2canvas, MIT; see `html2canvas.LICENSE`.
- `markdown-it.min.js`: markdown-it **15.0.2**, MIT; see `markdown-it.LICENSE`. Source: <https://github.com/markdown-it/markdown-it>. The browser UMD distribution was obtained from the official npm package and checked against its SHA-512 integrity value.

Markdown rendering disables raw HTML, automatic linkification and typography rewriting. Custom note links and highlights escape their labels; Markdown images are rendered as text rather than requesting arbitrary external images.
