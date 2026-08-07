@echo off
setlocal EnableExtensions EnableDelayedExpansion

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
call :open_extensions
echo Reload the extension to apply the update.
pause
exit /b 0

:open_extensions
set /a browser_count=0
call :add_running_browser "Google Chrome" "chrome" "chrome://extensions/"
call :add_running_browser "Microsoft Edge" "msedge" "edge://extensions/"
call :add_running_browser "Yandex Browser" "browser" "browser://extensions/"
call :add_running_browser "Opera" "opera" "opera://extensions/"
call :add_running_browser "Brave" "brave" "brave://extensions/"
call :add_running_browser "Vivaldi" "vivaldi" "vivaldi://extensions/"
call :add_browser "Google Chrome" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "chrome://extensions/"
call :add_browser "Google Chrome" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "chrome://extensions/"
call :add_browser "Google Chrome" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "chrome://extensions/"
call :add_browser "Microsoft Edge" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "edge://extensions/"
call :add_browser "Microsoft Edge" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "edge://extensions/"
call :add_browser "Microsoft Edge" "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" "edge://extensions/"
call :add_browser "Yandex Browser" "%LocalAppData%\Yandex\YandexBrowser\Application\browser.exe" "browser://extensions/"
call :add_browser "Opera" "%LocalAppData%\Programs\Opera\opera.exe" "opera://extensions/"
call :add_browser "Brave" "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" "brave://extensions/"
call :add_browser "Brave" "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe" "brave://extensions/"
call :add_browser "Vivaldi" "%LocalAppData%\Vivaldi\Application\vivaldi.exe" "vivaldi://extensions/"

if !browser_count! EQU 0 (
  echo No supported Chromium browser was found automatically.
  echo Open your browser extensions page manually and reload the extension.
  exit /b 0
)

echo.
echo Choose a browser to open its extensions page:
for /L %%I in (1,1,!browser_count!) do echo %%I. !browser_name_%%I!
set /p browser_choice=Browser number: 

for /L %%I in (1,1,!browser_count!) do (
  if "!browser_choice!"=="%%I" start "" /B "!browser_path_%%I!" "!browser_page_%%I!"
)
exit /b 0

:add_running_browser
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p = Get-Process -Name '%~2' -ErrorAction SilentlyContinue ^| Select-Object -First 1; if ($p) { [Console]::Write($p.Path) }"`) do call :add_browser "%~1 (running)" "%%P" "%~3"
exit /b 0

:add_browser
if exist "%~2" (
  set /a browser_count+=1
  set "browser_name_!browser_count!=%~1"
  set "browser_path_!browser_count!=%~2"
  set "browser_page_!browser_count!=%~3"
)
exit /b 0
