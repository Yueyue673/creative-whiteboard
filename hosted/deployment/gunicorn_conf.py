bind = "0.0.0.0:8000"
workers = 1
worker_class = "gthread"
threads = 2
preload_app = False
timeout = 90
graceful_timeout = 90
keepalive = 5
max_requests = 1000
max_requests_jitter = 100
worker_tmp_dir = "/tmp"
# Runtime administration uses the operator's container commands, with no
# additional control socket or writes to the read-only program directory.
control_socket_disable = True
accesslog = None
errorlog = "-"
loglevel = "info"
logger_class = "deployment.operator_logs.OperatorLogger"
# Django trusts exactly X-Forwarded-Proto behind the loopback-only proxy port.
# Gunicorn must not independently trust forwarded headers from arbitrary peers.
forwarded_allow_ips = ""
