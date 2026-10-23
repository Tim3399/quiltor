@echo off
rem Ausweichweg fuer den Teamaufbau: oeffnet fehlende Rollen-Chats per Deep-Link, einen nach dem anderen.
rem Normalerweise baut der Orchestrator das Team ohne Klick ueber die Routine "team-chat-start" auf.
cd /d "%~dp0.."
node team\bootstrap.mjs deeplink %*
echo.
pause
