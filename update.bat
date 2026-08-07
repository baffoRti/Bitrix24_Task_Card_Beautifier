@echo off
setlocal

cd /d "%~dp0"

echo Updating Bitrix24 Task Card Beautifier...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Update failed. Fix the Git error and try again.
  pause
  exit /b 1
)

echo.
echo Done. Opening chrome://extensions/...
start "" "chrome://extensions/"
echo Reload the extension to apply the update.
pause
