@echo off
cd /d "%~dp0"
echo Starting local dashboard + AI analysis server on port 8765...
python server.py 8888
pause
