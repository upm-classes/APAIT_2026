# APAIT · Proyecto GEE 

Scripts de demostración de las sesiones del proyecto de **Algoritmos de procesado y análisis de imagen. Aplicación a teledetección** (Grado en Ingeniería Informática).

## Cómo usarlos

1. Abrid el [Code Editor de Earth Engine](https://code.earthengine.google.com/) con vuestra cuenta.
2. Cread un script nuevo y pegad el contenido completo de uno de los archivos `.js`.
3. Pulsad **Run**.
4. Revisad los resultados en tres sitios:
   - **Layers** (panel del mapa): las capas van numeradas en el orden del proceso (`1.`, `2a.`, `2b.`…). Activadlas y desactivadlas una a una para ver qué aporta cada paso.
   - **Console**: cifras, umbrales y gráficos.
   - **Inspector**: haced clic en el mapa para ver el valor de cada capa en ese píxel.

## Scripts

| Archivo | Qué enseña | Ejemplo |
| --- | --- | --- |
| [`sesion_2a.js`](sesion_2a.js) | Índices NDVI, NBR, MNDWI, NDSI y EVI; imágenes diferencia (dNBR, dNDVI); serie temporal en un punto afectado y otro sin cambio; serie de cualquier punto al hacer clic en el mapa | Incendio de la Sierra de la Culebra |
| [`sesion_2b.js`](sesion_2b.js) | Serie temporal de superficie de agua: mosaicos diarios, filtro de fechas con nubes, mapas de las fechas de máximo y mínimo, frecuencia de agua y exportación a CSV | Embalse de Buendía |
| [`sesion_2c.js`](sesion_2c.js) | Histograma, umbral automático de Otsu frente al umbral de la bibliografía, mapa de comparación, clases de severidad, hectáreas por clase y leyenda | Incendio de la Sierra de la Culebra |
| [`sesion_2d.js`](sesion_2d.js) | Filtro de moda, erosión, dilatación, apertura y cierre; eliminación de grupos pequeños; máscaras de agua permanente, cobertura del suelo y relieve; superficie tras cada paso | Incendio de la Sierra de la Culebra |
| [`sesion_2e.js`](sesion_2e.js) | Radar Sentinel-1: selección de órbita, filtro del ruido *speckle*, cambio en dB, umbral de Otsu, condiciones por separado y limitaciones en zonas urbanas | Inundaciones de Emilia-Romaña |

## Datos utilizados

| Colección en GEE | Para qué |
| --- | --- |
| `COPERNICUS/S2_SR_HARMONIZED` | Sentinel-2 nivel 2A (reflectancia de superficie) |
| `GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED` | Máscara de nubes Cloud Score+ |
| `COPERNICUS/S1_GRD` | Sentinel-1 radar (VV, en dB) |
| `JRC/GSW1_4/GlobalSurfaceWater` | Agua permanente y extensión máxima histórica |
| `ESA/WorldCover/v200` | Cobertura del suelo 2021 a 10 m |
| `USGS/SRTMGL1_003` | Modelo digital de elevaciones (pendiente y sombreado) |
