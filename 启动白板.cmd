@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 goto tryPython
py -3 -c "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if errorlevel 1 goto tryPython
py -3 "%~dp0server.py" --open-browser
set "startExitCode=%errorlevel%"
goto finished
:tryPython
where python >nul 2>&1
if errorlevel 1 goto needPython
python -c "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if errorlevel 1 goto needPython
python "%~dp0server.py" --open-browser
set "startExitCode=%errorlevel%"
goto finished
:needPython
echo Python 3.10 or newer is required. See README.md for setup.
pause
exit /b 1
:finished
if not "%startExitCode%"=="0" pause
exit /b %startExitCode%
