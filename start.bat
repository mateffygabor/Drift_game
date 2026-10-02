@echo off
rem Starts a local web server for the game and opens it in the browser.
cd /d "%~dp0"
echo Starting the Drift Game 2 server (Python http.server, port 8002)...
start "DriftGame2 Server - keep this window open while playing" cmd /k python -m http.server 8002 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" http://localhost:8002
