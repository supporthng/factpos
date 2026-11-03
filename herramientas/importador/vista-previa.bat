@echo off
REM Doble clic: pide el archivo de respaldo y muestra qué se importaría (no cambia nada).
set /p ARCHIVO=Arrastre aqui el respaldo .sql y presione Enter: 
node importar.mjs --fuente wilpos --archivo %ARCHIVO%
echo.
echo Informe y archivos en la carpeta salida-importacion
pause
