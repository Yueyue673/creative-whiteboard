"""Controlled browser provider and bounded server lifetime for synthetic startup checks."""
from pathlib import Path
import argparse
import json
import os
import sys

HOOK = r"""
import json,os,threading,time
from http.server import ThreadingHTTPServer
if os.environ.get("START_FIXTURE_DATA_DENIED")=="1":
 from pathlib import Path
 import errno
 _mkdir=Path.mkdir
 def _given_mkdir(self,*args,**kwargs):
  if self.resolve()==(Path(os.environ["CREATIVE_BOARD_DATA_DIR"])/"内容").resolve():raise PermissionError(errno.EACCES,"Given data directory unavailable")
  return _mkdir(self,*args,**kwargs)
 Path.mkdir=_given_mkdir
_init=ThreadingHTTPServer.__init__
_serve=ThreadingHTTPServer.serve_forever
def _start_init(self,*args,**kwargs):
 _init(self,*args,**kwargs)
 path=os.environ.get("START_FIXTURE_IDENTITY")
 if path:
  with open(path,"w",encoding="utf8")as f:json.dump({"pid":os.getpid(),"boundPort":self.server_address[1],"at":time.time()},f)
def _start_serve(self,*args,**kwargs):
 lifetime=float(os.environ.get("START_FIXTURE_LIFETIME","0"))
 if not lifetime:return _serve(self,*args,**kwargs)
 timer=threading.Timer(lifetime,self.shutdown);timer.start()
 try:return _serve(self,*args,**kwargs)
 finally:timer.cancel()
ThreadingHTTPServer.__init__=_start_init
ThreadingHTTPServer.serve_forever=_start_serve
"""

BROWSER = r"""
import builtins,hashlib,json,os,sys,time
from urllib.request import build_opener,ProxyHandler
_request=build_opener(ProxyHandler({})).open
def open(url,*args,**kwargs):
 row={"url":url,"pid":os.getpid(),"at":time.time(),"controlledBrowserProvider":True,"pythonVersion":sys.version,"pythonExecutable":sys.executable}
 try:
  mode=os.environ.get("START_FIXTURE_BROWSER_MODE","true")
  if mode=="raise":raise RuntimeError("Given browser provider unavailable")
  if mode=="false":row["returned"]=False;return False
  assert url.startswith("http://127.0.0.1:"),"Fixture requests stay on the owned loopback service"
  with _request(url+"api/health",timeout=4)as response:row["healthStatus"]=response.status
  with _request(url+"index.html",timeout=4)as response:row["indexSHA256"]=hashlib.sha256(response.read()).hexdigest()
  row["returned"]=True
  return True
 except Exception as error:
  row["returned"]=False;row["errorType"]=type(error).__name__;raise
 finally:
  path=os.environ["START_FIXTURE_OPEN_LOG"]
  with builtins.open(path+".tmp","w",encoding="utf8")as f:json.dump(row,f)
  os.replace(path+".tmp",path)
"""

def write_hooks(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "sitecustomize.py").write_text(HOOK, encoding="utf8")
    (destination / "webbrowser.py").write_text(BROWSER, encoding="utf8")
    return destination

def fixture_env(data, port, hooks, open_log, identity, *, mode="true", lifetime=0, deny_data=False):
    env = {key: value for key, value in os.environ.items() if not key.startswith("CREATIVE_BOARD_HOSTED_")}
    env.pop("PYTHONHOME", None)
    env.update({
        "CREATIVE_BOARD_DATA_DIR": str(data), "CREATIVE_BOARD_PORT": str(port),
        "PYTHONPATH": str(hooks), "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8", "START_FIXTURE_OPEN_LOG": str(open_log),
        "START_FIXTURE_IDENTITY": str(identity), "START_FIXTURE_BROWSER_MODE": mode,
        "START_FIXTURE_LIFETIME": str(lifetime), "START_FIXTURE_DATA_DENIED": "1" if deny_data else "0",
    })
    return env

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-hooks", required=True)
    args = parser.parse_args()
    write_hooks(args.write_hooks)
    print(json.dumps({"controlledBrowserProvider": True, "physicalBrowserUsed": False}))
