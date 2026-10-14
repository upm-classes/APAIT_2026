/*******************************************************************************
 * APAIT · Proyecto GEE · Sesión 2 · Demo 2.1
 * ÍNDICES ESPECTRALES Y SERIES TEMPORALES
 *
 * Ejemplo: incendio de la Sierra de la Culebra (Sarracín–Ferreras, Zamora),
 *          15–24 de junio de 2022 (~27 000 ha con algún grado de severidad).
 ******************************************************************************/

// ===== 0. ZONA DE ESTUDIO Y PARÁMETROS ======================================
// Polígono que engloba el área quemada (de Mahíde/Villardeciervos al valle del Tera)
var aoi = ee.Geometry.Polygon([[
  [-6.45, 41.78], [-5.95, 41.78], [-5.95, 42.03], [-6.45, 42.03], [-6.45, 41.78]
]]);
var PRE    = ['2022-05-15', '2022-06-14'];
// La ventana post termina el 15 de julio: el 17 de julio empezó el incendio de
// Losacio, justo al este, y contaminaría el resultado.
var POST   = ['2022-06-25', '2022-07-15'];
var ESCALA = 20;   // m (resolución de B11 y B12)

Map.centerObject(aoi, 10);
Map.addLayer(ee.Image().paint(aoi, 0, 2), {palette: ['yellow']}, '0. AOI');

// ===== 1. COMPOSITES PRE Y POST (Sentinel-2 L2A + Cloud Score+) ==============
var S2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
var CS = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
var BANDAS = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'];

function mascaraS2(img) {
  return img.select(BANDAS).divide(10000)                 // reflectancia 0–1
    .updateMask(img.select('cs_cdf').gte(0.60))           // fuera nubes y sombras
    .set('system:time_start', img.get('system:time_start'));
}
function compositeS2(fechas) {
  return S2.filterBounds(aoi).filterDate(fechas[0], fechas[1])
    .linkCollection(CS, ['cs_cdf'])
    .map(mascaraS2)
    .median()
    .clip(aoi);
}

var pre  = compositeS2(PRE);
var post = compositeS2(POST);
var visSWIR = {bands: ['B12', 'B8', 'B4'], min: 0, max: 0.4};
Map.addLayer(pre,  visSWIR, '1a. Composite PRE (SWIR)');
Map.addLayer(post, visSWIR, '1b. Composite POST (SWIR)');

// ===== 2. CÁLCULO DE ÍNDICES ================================================
function indices(img) {
  var ndvi  = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var nbr   = img.normalizedDifference(['B8', 'B12']).rename('NBR');
  var mndwi = img.normalizedDifference(['B3', 'B11']).rename('MNDWI');
  // NDSI usa la misma fórmula que MNDWI; la nieve se separa con NIR alto
  var nieve = mndwi.gt(0.4).and(img.select('B8').gt(0.11)).rename('NIEVE');
  // Índice con expresión: EVI
  var evi = img.expression('2.5 * (N - R) / (N + 6 * R - 7.5 * B + 1)', {
    N: img.select('B8'), R: img.select('B4'), B: img.select('B2')
  }).rename('EVI');
  return img.addBands([ndvi, nbr, mndwi, nieve, evi]);
}
var preI  = indices(pre);
var postI = indices(post);
print('2. Bandas tras calcular índices:', postI.bandNames());

var visNDVI  = {bands: ['NDVI'],  min: -0.2, max: 0.9, palette: ['8c510a', 'f6e8c3', '1b7837']};
var visNBR   = {bands: ['NBR'],   min: -0.5, max: 0.8, palette: ['000000', 'e66101', 'ffffff', '1b7837']};
var visMNDWI = {bands: ['MNDWI'], min: -0.6, max: 0.6, palette: ['ffffff', '00ffff', '0000ff']};
var visEVI   = {bands: ['EVI'],   min: 0,    max: 0.6, palette: ['f6e8c3', '1b7837']};

Map.addLayer(preI,  visNDVI, '2a. NDVI pre',  false);
Map.addLayer(postI, visNDVI, '2b. NDVI post', false);
Map.addLayer(preI,  visNBR,  '2c. NBR pre');
Map.addLayer(postI, visNBR,  '2d. NBR post');
Map.addLayer(postI, visMNDWI, '2e. MNDWI post', false);
Map.addLayer(postI.select('NIEVE').selfMask(), {palette: ['00ffff']}, '2f. Nieve post (debe salir vacía)', false);
Map.addLayer(postI, visEVI,  '2g. EVI post', false);

// ===== 3. IMÁGENES DIFERENCIA ===============================================
var dNBR  = preI.select('NBR').subtract(postI.select('NBR')).rename('dNBR');
var dNDVI = preI.select('NDVI').subtract(postI.select('NDVI')).rename('dNDVI');
var visDif = {min: -0.2, max: 0.8, palette: ['1a9850', 'ffffbf', 'fdae61', 'd73027', '7b3294']};
Map.addLayer(dNDVI, visDif, '3a. dNDVI (pre − post)', false);
Map.addLayer(dNBR,  visDif, '3b. dNBR (pre − post)');

print('3. Estadísticos de dNBR en el AOI:', dNBR.reduceRegion({
  reducer: ee.Reducer.mean().combine(ee.Reducer.minMax(), '', true),
  geometry: aoi, scale: ESCALA, maxPixels: 1e10
}));

// ===== 4. PUNTOS PARA LA SERIE TEMPORAL =====================================
// Se eligen automáticamente: uno con quemado alto (dNBR > 0.44) y otro sin
// cambio (|dNBR| < 0.05) con vegetación densa antes del incendio.
var quemadoAlto = dNBR.gt(0.44);
var sinCambio   = dNBR.abs().lt(0.05).and(preI.select('NDVI').gt(0.5));
var claseMuestra = ee.Image(0).where(quemadoAlto, 1).rename('clase').toInt()
  .updateMask(quemadoAlto.or(sinCambio));

var puntos = claseMuestra.stratifiedSample({
  numPoints: 1, classBand: 'clase', region: aoi, scale: ESCALA,
  seed: 3, geometries: true
}).map(function (f) {
  return f.set('etiqueta', ee.Algorithms.If(
    ee.Number(f.get('clase')).eq(1), 'afectado', 'no afectado'));
});
print('4. Puntos de la serie:', puntos);
Map.addLayer(puntos.filter(ee.Filter.eq('clase', 1)), {color: 'ff0000'}, '4a. Punto afectado');
Map.addLayer(puntos.filter(ee.Filter.eq('clase', 0)), {color: '00ff00'}, '4b. Punto no afectado');

// ===== 5. SERIE TEMPORAL DE NBR (2021–2023) ==================================
var serie = S2.filterBounds(aoi).filterDate('2021-06-01', '2023-12-31')
  .linkCollection(CS, ['cs_cdf'])
  .map(mascaraS2)
  .map(function (img) {
    return img.normalizedDifference(['B8', 'B12']).rename('NBR')
      .set('system:time_start', img.get('system:time_start'));
  });
print('5. Nº de imágenes en la serie:', serie.size());

print(ui.Chart.image.seriesByRegion({
  imageCollection: serie, regions: puntos, reducer: ee.Reducer.mean(),
  band: 'NBR', scale: ESCALA, seriesProperty: 'etiqueta'
}).setOptions({
  title: '5. NBR antes y después del incendio (15 jun 2022)',
  vAxis: {title: 'NBR'}, lineWidth: 1, pointSize: 3,
  series: {0: {color: 'red'}, 1: {color: 'green'}}
}));

// ===== 6. SERIE AL HACER CLIC EN EL MAPA ====================================
var panel = ui.Panel({style: {width: '420px', position: 'bottom-right'}});
panel.add(ui.Label('6. Haz clic en el mapa para ver la serie de NBR de ese punto'));
Map.add(panel);

Map.onClick(function (c) {
  var p = ee.Geometry.Point([c.lon, c.lat]);
  Map.addLayer(p, {color: 'ff00ff'}, '6. Punto consultado');
  panel.widgets().reset([ui.Chart.image.series({
    imageCollection: serie, region: p, reducer: ee.Reducer.mean(), scale: ESCALA
  }).setOptions({
    title: 'NBR en ' + c.lon.toFixed(4) + ', ' + c.lat.toFixed(4),
    lineWidth: 1, pointSize: 3, legend: {position: 'none'}
  })]);
});
