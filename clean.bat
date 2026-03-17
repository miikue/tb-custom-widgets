@echo off
echo Mazani nepotrebnych souboru a slozek...

REM Mazani slozek
echo.
echo Mazani slozek...
if exist "dist" (
    echo   - dist
    rd /s /q "dist"
)
if exist "tmp" (
    echo   - tmp
    rd /s /q "tmp"
)
if exist "out-tsc" (
    echo   - out-tsc
    rd /s /q "out-tsc"
)
if exist "node_modules" (
    echo   - node_modules
    rd /s /q "node_modules"
)
if exist ".angular" (
    echo   - .angular
    rd /s /q ".angular"
)
if exist "coverage" (
    echo   - coverage
    rd /s /q "coverage"
)
if exist "target" (
    echo   - target
    rd /s /q "target"
)
if exist "build" (
    echo   - build
    rd /s /q "build"
)


REM Mazani souboru
echo.
echo Mazani souboru...
del /s /q /f *.log > nul 2>&1
del /s /q /f .DS_Store > nul 2>&1
del /s /q /f Thumbs.db > nul 2>&1
del /s /q /f yarn-error.log > nul 2>&1
del /s /q /f npm-debug.log > nul 2>&1
del /s /q /f style.comp.scss > nul 2>&1
del /s /q /f **\dependency-reduced-pom.xml > nul 2>&1


echo.
echo Cisteni dokonceno.
pause
