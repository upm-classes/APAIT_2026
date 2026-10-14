/*******************************************************************************
 * APAIT · Proyecto GEE · Sesión 2 · Demo 2.2
 * SERIE TEMPORAL DE SUPERFICIE DE AGUA
 *
 * Ejemplo: embalse de Buendía (Cuenca–Guadalajara)

 ******************************************************************************/

// ===== 0. ZONA DE ESTUDIO Y PARÁMETROS ======================================
// Polígono que engloba la presa y las colas del Guadiela y del Mayor.
var aoi = ee.Geometry.Polygon([[
  [-2.82, 40.30], [-2.55, 40.30], [-2.55, 40.49], [-2.82, 40.49], [-2.82, 40.30]
]]);
// Dos años (sequía 2022–2023) para que la serie se calcule en clase sin agotar
// memoria; para periodos largos, exportad la tabla (bloque 8).
var INICIO = '2022-01-01';
var FIN    = '2023-12-31';
var ESCALA = 20;            // m (B11 es de 20 m) para los mapas
var ESCALA_SERIE = 30;      // m para la serie: 2,25 veces menos píxeles por fecha
var UMBRAL_MNDWI = 0;       // punto de partida; ajustar con Otsu (demo 2.3)

Map.centerObject(aoi, 11);
Map.addLayer(ee.Image().paint(aoi, 0, 2), {palette: ['yellow']}, '0. AOI');

// ===== 1. ZONA DEL EMBALSE A PARTIR DE JRC GLOBAL SURFACE WATER ==============
// max_extent = píxeles que han tenido agua alguna vez (1984–2021).
// Se usa como zona de análisis para no contar charcas ni balsas ajenas.
// (No se amplía con focalMax: una operación focal se recalcularía en cada
// una de las ~150 fechas de la serie y agotaría la memoria.)
var extMax = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('max_extent').clip(aoi);
var zona = extMax.selfMask().rename('zona');
Map.addLayer(extMax.selfMask(), {palette: ['0000ff']}, '1a. Extensión máxima histórica (JRC)');
Map.addLayer(zona, {palette: ['00ffff'], opacity: 0.4}, '1b. Zona de análisis', false);

print('1. Superficie máxima histórica en el AOI (ha) — debe rondar 8 000–9 000:',
  extMax.selfMask().multiply(ee.Image.pixelArea()).divide(1e4).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e10
  }).get('max_extent'));

// ===== 2. COLECCIÓN SENTINEL-2 ENMASCARADA ===================================
var S2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
var CS = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

var BANDAS = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'];

// Colecciones SIN procesar: filtrarlas y leer sus fechas solo usa metadatos,
// así que es casi instantáneo.
var s2col = S2.filterBounds(aoi).filterDate(INICIO, FIN)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70));   // descarta escenas casi cubiertas
var cscol = CS.filterBounds(aoi).filterDate(INICIO, FIN);
print('2. Nº de escenas Sentinel-2:', s2col.size());

// Si el embalse cae entre dos teselas, cada escena lo cubre a medias:
// se une todo lo adquirido el mismo día en un mosaico, y DESPUÉS se enmascara.
// (Construir los mosaicos a partir de una colección ya enmascarada con
// linkCollection obliga a repetir el emparejamiento para cada día y agota
// la memoria de GEE.)
function imagenDia(fecha) {                  // fecha: texto 'YYYY-MM-dd'
  var f = ee.Date.parse('YYYY-MM-dd', fecha);
  var s2 = s2col.filterDate(f, f.advance(1, 'day')).mosaic();
  var cs = cscol.filterDate(f, f.advance(1, 'day')).mosaic();
  return s2.select(BANDAS).divide(10000)
    .updateMask(cs.select('cs_cdf').gte(0.60))   // fuera nubes y sombras
    .clip(aoi)
    .set('system:time_start', f.millis())
    .set('fecha', fecha);
}

// Lista de días con imagen (solo metadatos)
function fechas(coleccion) {
  return coleccion.aggregate_array('system:time_start')
    .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); })
    .distinct();
}
var diasS2 = fechas(s2col);
var diasCS = fechas(cscol);
// Algunos días tienen escena Sentinel-2 pero no máscara Cloud Score+:
// sin ella el mosaico de nubes no tendría bandas, así que se descartan.
var dias = diasS2.filter(ee.Filter.inList('item', diasCS));
print('2. Días con Sentinel-2:', diasS2.length());
print('2. Días con Sentinel-2 y Cloud Score+ (mosaicos diarios):', dias.length());

var porDia = ee.ImageCollection.fromImages(dias.map(imagenDia));

// ===== 3. UNA FECHA DE EJEMPLO: IMAGEN, MNDWI Y AGUA ==========================
// Las capas del mapa se construyen siempre con imagenDia() (no desde la serie):
// el mapa se calcula por teselas y cada tesela no debe recalcular la serie entera.
// Fecha con menos nubes de agosto de 2023 (se puede sustituir por un texto
// 'YYYY-MM-dd' de cualquier día con imagen)
// (de entre los días que también tienen Cloud Score+)
var FECHA_EJEMPLO = s2col.filterDate('2023-08-01', '2023-09-01')
  .sort('CLOUDY_PIXEL_PERCENTAGE')
  .aggregate_array('system:time_start')
  .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); })
  .filter(ee.Filter.inList('item', dias))
  .get(0);
print('3. Fecha del ejemplo:', FECHA_EJEMPLO);
var ejemplo = imagenDia(FECHA_EJEMPLO);
Map.addLayer(ejemplo, {bands: ['B8', 'B11', 'B4'], min: 0, max: 0.4}, '3a. Imagen ejemplo (agua en negro)');
var mndwiEj = ejemplo.normalizedDifference(['B3', 'B11']).rename('MNDWI');
Map.addLayer(mndwiEj, {min: -0.6, max: 0.6, palette: ['ffffff', '00ffff', '0000ff']}, '3b. MNDWI ejemplo');
Map.addLayer(mndwiEj.gt(UMBRAL_MNDWI).updateMask(zona).selfMask(),
  {palette: ['0000ff']}, '3c. Agua ejemplo (MNDWI > umbral, dentro de la zona)');

// ===== 4. SUPERFICIE DE AGUA Y FRACCIÓN VÁLIDA POR FECHA ======================
// Superficie total de la zona de análisis (se calcula una sola vez)
var zonaHa = ee.Number(zona.gt(0).multiply(ee.Image.pixelArea()).divide(1e4).reduceRegion({
  reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA_SERIE, maxPixels: 1e10
}).get('zona'));

function superficieAgua(img) {
  var ha = ee.Image.pixelArea().divide(1e4);
  // Banda 1: hectáreas de agua (los píxeles con nube quedan enmascarados)
  var agua = img.normalizedDifference(['B3', 'B11']).gt(UMBRAL_MNDWI)
    .multiply(ha).rename('agua');
  // Banda 2: hectáreas con dato válido (sin nube y dentro de la escena)
  var valido = img.select('B3').mask().gt(0).multiply(ha).rename('valido');
  // Una sola reducción por fecha para las dos bandas (más rápido)
  // tileScale: 4 divide el cálculo en teselas más pequeñas: evita el error
  // "memory capacity exceeded" a cambio de tardar algo más.
  var suma = agua.addBands(valido).updateMask(zona).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA_SERIE,
    maxPixels: 1e10, tileScale: 4
  });
  return ee.Feature(null, {
    'system:time_start': img.get('system:time_start'),
    fecha: img.get('fecha'),
    ha_agua: suma.get('agua'),
    fraccion_valida: ee.Number(suma.get('valido')).divide(zonaHa)
  });
}
// Si los gráficos dan "Computation timed out", acortad INICIO–FIN o usad el
// bloque 8 (exportar) y graficad el CSV fuera de GEE.

var serieTodas = ee.FeatureCollection(porDia.map(superficieAgua));
var serieAgua  = serieTodas.filter(ee.Filter.gt('fraccion_valida', 0.95));
print('4. Fechas válidas (>95 % de la zona sin nubes):', serieAgua.size());

// ===== 5. GRÁFICOS: TODAS LAS FECHAS FRENTE A SOLO LAS VÁLIDAS ================
print(ui.Chart.feature.byFeature({
  features: serieTodas, xProperty: 'system:time_start', yProperties: ['ha_agua']
}).setChartType('ScatterChart').setOptions({
  title: '5a. Superficie de agua, todas las fechas (las nubes "quitan" agua)',
  vAxis: {title: 'ha'}, pointSize: 2, legend: {position: 'none'}, colors: ['999999']
}));

print(ui.Chart.feature.byFeature({
  features: serieAgua, xProperty: 'system:time_start', yProperties: ['ha_agua']
}).setChartType('LineChart').setOptions({
  title: '5b. Superficie de agua, solo fechas válidas',
  vAxis: {title: 'ha'}, pointSize: 3, lineWidth: 1, legend: {position: 'none'}, colors: ['0000ff']
}));

// ===== 6. MAPAS DE LAS FECHAS DE MÁXIMO Y MÍNIMO ==============================
// Las fechas extremas se piden UNA sola vez al servidor con evaluate().
// Con la fecha ya en el navegador, los mapas se construyen con imagenDia():
// si se construyeran desde serieAgua, cada tesela del mapa recalcularía
// la serie entera y GEE agotaría la memoria.
function mapaFecha(fecha, nombre, color) {
  var img = imagenDia(fecha);
  Map.addLayer(img, {bands: ['B8', 'B11', 'B4'], min: 0, max: 0.4}, nombre + ' · imagen', false);
  Map.addLayer(img.normalizedDifference(['B3', 'B11']).gt(UMBRAL_MNDWI)
    .updateMask(zona).selfMask(), {palette: [color]}, nombre);
}

var maximo = ee.Feature(serieAgua.sort('ha_agua', false).first());
var minimo = ee.Feature(serieAgua.sort('ha_agua').first());
ee.Dictionary({
  fechaMax: maximo.get('fecha'), haMax: maximo.get('ha_agua'),
  fechaMin: minimo.get('fecha'), haMin: minimo.get('ha_agua')
}).evaluate(function (e, error) {
  if (error) { print('6. Error al calcular las fechas extremas:', error); return; }
  print('6. Máximo: ' + e.fechaMax + ' · ' + Math.round(e.haMax) + ' ha');
  print('6. Mínimo: ' + e.fechaMin + ' · ' + Math.round(e.haMin) + ' ha');
  mapaFecha(e.fechaMax, '6a. Agua en la fecha de MÁXIMO (' + e.fechaMax + ')', '08306b');
  mapaFecha(e.fechaMin, '6b. Agua en la fecha de MÍNIMO (' + e.fechaMin + ')', 'ff0000');
});

// ===== 7. FRECUENCIA DE AGUA EN EL PERIODO ===================================
// % de observaciones válidas en las que el píxel tenía agua
// Se calcula escena a escena (no con los mosaicos diarios): es mucho más
// ligero para el mapa. Los píxeles con nube no cuentan.
var frecuencia = s2col.linkCollection(CS, ['cs_cdf']).map(function (img) {
  return img.normalizedDifference(['B3', 'B11']).gt(UMBRAL_MNDWI)
    .updateMask(img.select('cs_cdf').gte(0.60));
}).mean().multiply(100).updateMask(zona).clip(aoi);
Map.addLayer(frecuencia, {min: 0, max: 100, palette: ['ffffcc', '41b6c4', '081d58']},
  '7. Frecuencia de agua ' + INICIO.slice(0, 4) + '–' + FIN.slice(0, 4) + ' (%)');

// ===== 8. EXPORTAR LA SERIE (por si el gráfico tarda demasiado) ===============
Export.table.toDrive({
  collection: serieAgua, description: 'serie_agua_embalse',
  folder: 'APAIT', fileFormat: 'CSV',
  selectors: ['fecha', 'ha_agua', 'fraccion_valida']
});