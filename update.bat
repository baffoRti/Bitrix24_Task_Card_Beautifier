@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo Updating Bitrix24 Task Card Beautifier...
git pull --ff-only

echo.
echo Done.
echo Open chrome://extensions/ and reload the extension to apply the update.
pause
