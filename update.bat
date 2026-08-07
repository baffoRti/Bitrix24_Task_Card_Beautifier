@echo off
setlocal EnableExtensions

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
echo Done.
echo Open chrome://extensions/ and reload the extension to apply the update.
pause
