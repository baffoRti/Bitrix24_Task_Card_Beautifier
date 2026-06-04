@echo off
setlocal

cd /d "%~dp0"

echo Updating Bitrix24 Task Card Beautifier...
git pull --ff-only

echo.
echo Done. Open chrome://extensions/ and reload the extension.
pause
