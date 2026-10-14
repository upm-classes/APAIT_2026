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
var INICIO = '2019-01-01';
var FIN    = '2025-12-31';
var ESCALA = 20;            // m (B11 es de 20 m)
var UMBRAL_MNDWI = 0;       // punto de partida; ajustar con Otsu (demo 2.3)

Map.centerObject(aoi, 11);
Map.addLayer(ee.Image().paint(aoi, 0, 2), {palette: ['yellow']}, '0. AOI');

// ===== 1. ZONA DEL EMBALSE A PARTIR DE JRC GLOBAL SURFACE WATER ==============
// max_extent = píxeles que han tenido agua alguna vez (1984–2021).
// Se amplía 100 m para no perder orillas y se usa para no contar charcas ajenas.
var extMax = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('max_extent').clip(aoi);
var zona = extMax.focalMax(100, 'circle', 'meters').selfMask().rename('zona');
Map.addLayer(extMax.selfMask(), {palette: ['0000ff']}, '1a. Extensión máxima histórica (JRC)');
Map.addLayer(zona, {palette: ['00ffff'], opacity: 0.4}, '1b. Zona de análisis (+100 m)', false);

print('1. Superficie máxima histórica en el AOI (ha) — debe rondar 8 000–9 000:',
  extMax.selfMask().multiply(ee.Image.pixelArea()).divide(1e4).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e10
  }).get('max_extent'));

// ===== 2. COLECCIÓN SENTINEL-2 ENMASCARADA ===================================
var S2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
var CS = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

function mascaraS2(img) {
  return img.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12']).divide(10000)
    .updateMask(img.select('cs_cdf').gte(0.60))
    .set('system:time_start', img.get('system:time_start'));
}

var col = S2.filterBounds(aoi).filterDate(INICIO, FIN)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70))   // descarta escenas casi cubiertas
  .linkCollection(CS, ['cs_cdf'])
  .map(mascaraS2);
print('2. Nº de escenas:', col.size());

// Si el embalse cae entre dos teselas, cada escena lo cubre a medias:
// se une todo lo adquirido el mismo día en un mosaico.
var dias = col.aggregate_array('system:time_start')
  .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); })
  .distinct();
var porDia = ee.ImageCollection.fromImages(dias.map(function (d) {
  var f = ee.Date.parse('YYYY-MM-dd', d);
  return col.filterDate(f, f.advance(1, 'day')).mosaic().clip(aoi)
    .set('system:time_start', f.millis())
    .set('fecha', d);
}));
print('2. Nº de fechas (mosaicos diarios):', porDia.size());

// ===== 3. UNA FECHA DE EJEMPLO: IMAGEN, MNDWI Y AGUA ==========================
var ejemplo = ee.Image(porDia.filterDate('2023-08-01', '2023-09-01').first());
print('3. Fecha del ejemplo:', ejemplo.get('fecha'));
Map.addLayer(ejemplo, {bands: ['B8', 'B11', 'B4'], min: 0, max: 0.4}, '3a. Imagen ejemplo (agua en negro)');
var mndwiEj = ejemplo.normalizedDifference(['B3', 'B11']).rename('MNDWI');
Map.addLayer(mndwiEj, {min: -0.6, max: 0.6, palette: ['ffffff', '00ffff', '0000ff']}, '3b. MNDWI ejemplo');
Map.addLayer(mndwiEj.gt(UMBRAL_MNDWI).updateMask(zona).selfMask(),
  {palette: ['0000ff']}, '3c. Agua ejemplo (MNDWI > umbral, dentro de la zona)');

// ===== 4. SUPERFICIE DE AGUA Y FRACCIÓN VÁLIDA POR FECHA ======================
// Superficie total de la zona de análisis (se calcula una sola vez)
var zonaHa = ee.Number(zona.gt(0).multiply(ee.Image.pixelArea()).divide(1e4).reduceRegion({
  reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA, maxPixels: 1e10
}).get('zona'));

function superficieAgua(img) {
  var ha = ee.Image.pixelArea().divide(1e4);
  // Banda 1: hectáreas de agua (los píxeles con nube quedan enmascarados)
  var agua = img.normalizedDifference(['B3', 'B11']).gt(UMBRAL_MNDWI)
    .multiply(ha).rename('agua');
  // Banda 2: hectáreas con dato válido (sin nube y dentro de la escena)
  var valido = img.select('B3').mask().gt(0).multiply(ha).rename('valido');
  // Una sola reducción por fecha para las dos bandas (más rápido)
  var suma = agua.addBands(valido).updateMask(zona).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA, maxPixels: 1e10
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
function mapaFecha(feature, nombre, color) {
  feature = ee.Feature(feature);
  var img = ee.Image(porDia.filter(ee.Filter.eq('fecha', feature.get('fecha'))).first());
  Map.addLayer(img.normalizedDifference(['B3', 'B11']).gt(UMBRAL_MNDWI)
    .updateMask(zona).selfMask(), {palette: [color]}, nombre);
  print(nombre, feature.get('fecha'), feature.get('ha_agua'));
}
mapaFecha(serieAgua.sort('ha_agua', false).first(), '6a. Agua en la fecha de MÁXIMO', '08306b');
mapaFecha(serieAgua.sort('ha_agua').first(),        '6b. Agua en la fecha de MÍNIMO', 'ff0000');

// ===== 7. FRECUENCIA DE AGUA EN EL PERIODO ===================================
// % de observaciones válidas en las que el píxel tenía agua
var frecuencia = porDia.map(function (img) {
  return img.normalizedDifference(['B3', 'B11']).gt(UMBRAL_MNDWI);
}).mean().multiply(100).updateMask(zona);
Map.addLayer(frecuencia, {min: 0, max: 100, palette: ['ffffcc', '41b6c4', '081d58']},
  '7. Frecuencia de agua 2019–2025 (%)');

// ===== 8. EXPORTAR LA SERIE (por si el gráfico tarda demasiado) ===============
Export.table.toDrive({
  collection: serieAgua, description: 'serie_agua_embalse',
  folder: 'APAIT', fileFormat: 'CSV',
  selectors: ['fecha', 'ha_agua', 'fraccion_valida']
});
