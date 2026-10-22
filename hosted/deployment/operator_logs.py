"""HTTP request strings never enter the Gunicorn log stream."""
from gunicorn.glogging import Logger


class OperatorLogger(Logger):
    def access(self, *args, **kwargs):
        return

    def error(self, *args, **kwargs):
        self.error_log.error("Hosted runtime error; request details omitted. Run the offline configuration check for diagnostics.")

    def warning(self, *args, **kwargs):
        self.error_log.warning("Hosted runtime warning; request details omitted.")

    def exception(self, *args, **kwargs):
        self.error_log.error("Hosted worker exception; request details omitted.")
