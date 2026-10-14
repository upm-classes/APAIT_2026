/*******************************************************************************
 * APAIT · Proyecto GEE · Sesión 2 · Demo 2.3
 * HISTOGRAMAS, UMBRAL DE OTSU Y CLASES DE SEVERIDAD
 *
 * Ejemplo: incendio de la Sierra de la Culebra (Sarracín–Ferreras, Zamora),
 *          15–24 de junio de 2022.
 ******************************************************************************/

// ===== 0. ZONA DE ESTUDIO Y PARÁMETROS ======================================
var aoi = ee.Geometry.Polygon([[
  [-6.45, 41.78], [-5.95, 41.78], [-5.95, 42.03], [-6.45, 42.03], [-6.45, 41.78]
]]);
var PRE    = ['2022-05-15', '2022-06-14'];
var POST   = ['2022-06-25', '2022-07-15'];   // antes del incendio de Losacio (17 jul)
var ESCALA = 20;
var UMBRAL_BIBLIO = 0.10;                    // dNBR > 0.10 = quemado (USGS)

Map.centerObject(aoi, 10);
Map.addLayer(ee.Image().paint(aoi, 0, 2), {palette: ['yellow']}, '0. AOI');

// ===== 1. COMPOSITES Y dNBR ==================================================
var S2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
var CS = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
function mascaraS2(img) {
  return img.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12']).divide(10000)
    .updateMask(img.select('cs_cdf').gte(0.60))
    .set('system:time_start', img.get('system:time_start'));
}
function compositeS2(fechas) {
  return S2.filterBounds(aoi).filterDate(fechas[0], fechas[1])
    .linkCollection(CS, ['cs_cdf']).map(mascaraS2).median().clip(aoi);
}
var pre  = compositeS2(PRE);
var post = compositeS2(POST);
Map.addLayer(post, {bands: ['B12', 'B8', 'B4'], min: 0, max: 0.4}, '1a. Composite POST (SWIR)', false);

var nbrPre  = pre.normalizedDifference(['B8', 'B12']);
var nbrPost = post.normalizedDifference(['B8', 'B12']);
var dNBR = nbrPre.subtract(nbrPost).rename('dNBR');
Map.addLayer(dNBR, {min: -0.2, max: 0.8,
  palette: ['1a9850', 'ffffbf', 'fdae61', 'd73027', '7b3294']}, '1b. dNBR');

// ===== 2. HISTOGRAMA ========================================================
print(ui.Chart.image.histogram({
  image: dNBR, region: aoi, scale: ESCALA, maxBuckets: 200, maxPixels: 1e9
}).setOptions({
  title: '2. Histograma de dNBR (pico en 0 = sin cambio; cola derecha = quemado)',
  hAxis: {title: 'dNBR'}, vAxis: {title: 'nº de píxeles'}, legend: {position: 'none'}
}));

// ===== 3. UMBRAL DE OTSU ====================================================
// Busca el valor que maximiza la varianza entre las dos clases del histograma.
function otsu(histograma) {
  histograma = ee.Dictionary(histograma);
  var cuentas = ee.Array(histograma.get('histogram'));
  var medias  = ee.Array(histograma.get('bucketMeans'));
  var n       = medias.length().get([0]);
  var total   = cuentas.reduce(ee.Reducer.sum(), [0]).get([0]);
  var suma    = medias.multiply(cuentas).reduce(ee.Reducer.sum(), [0]).get([0]);
  var media   = suma.divide(total);

  var varEntre = ee.List.sequence(1, n.subtract(1)).map(function (i) {
    var cA = cuentas.slice(0, 0, i);
    var nA = cA.reduce(ee.Reducer.sum(), [0]).get([0]);
    var mA = medias.slice(0, 0, i).multiply(cA)
      .reduce(ee.Reducer.sum(), [0]).get([0]).divide(nA);
    var nB = total.subtract(nA);
    var mB = suma.subtract(nA.multiply(mA)).divide(nB);
    return nA.multiply(mA.subtract(media).pow(2))
      .add(nB.multiply(mB.subtract(media).pow(2)));
  });
  return medias.slice(0, 0, n.subtract(1)).sort(varEntre).get([-1]);
}

var hist = dNBR.reduceRegion({
  reducer: ee.Reducer.histogram(255, 0.01),
  geometry: aoi, scale: ESCALA, maxPixels: 1e10, bestEffort: true
}).get('dNBR');
var umbralOtsu = ee.Number(otsu(hist));
print('3. Umbral de Otsu para dNBR:', umbralOtsu);
print('3. Umbral de la bibliografía:', UMBRAL_BIBLIO);

// ===== 4. LAS DOS MÁSCARAS Y SU COMPARACIÓN ==================================
var quemadoBiblio = dNBR.gt(UMBRAL_BIBLIO).rename('quemado');
var quemadoOtsu   = dNBR.gt(umbralOtsu).rename('quemado');
Map.addLayer(quemadoBiblio.selfMask(), {palette: ['ff8c00']}, '4a. Quemado (umbral 0.10)', false);
Map.addLayer(quemadoOtsu.selfMask(),   {palette: ['ff0000']}, '4b. Quemado (Otsu)', false);

// 1 = solo bibliografía, 2 = solo Otsu, 3 = ambos
var comparacion = quemadoBiblio.add(quemadoOtsu.multiply(2)).selfMask();
Map.addLayer(comparacion, {min: 1, max: 3, palette: ['ffd700', '00bfff', 'b22222']},
  '4c. Comparación (amarillo: solo 0.10 · azul: solo Otsu · rojo: ambos)');

function hectareas(mascara) {
  return mascara.selfMask().multiply(ee.Image.pixelArea()).divide(1e4).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA, maxPixels: 1e10
  }).get('quemado');
}
print('4. Superficie quemada con umbral 0.10 (ha):', hectareas(quemadoBiblio));
print('4. Superficie quemada con Otsu (ha):', hectareas(quemadoOtsu));

// ===== 5. CLASES DE SEVERIDAD (umbrales USGS) ================================
var severidad = ee.Image(0)
  .where(dNBR.gte(0.10), 1)   // baja
  .where(dNBR.gte(0.27), 2)   // moderada-baja
  .where(dNBR.gte(0.44), 3)   // moderada-alta
  .where(dNBR.gte(0.66), 4)   // alta
  .rename('severidad').toByte().clip(aoi);

var PALETA_SEV = ['ffffff', 'fee08b', 'fdae61', 'f46d43', 'a50026'];
Map.addLayer(severidad.selfMask(), {min: 0, max: 4, palette: PALETA_SEV}, '5. Severidad (USGS)');

// Superficie por clase (reductor agrupado) y gráfico
var porClase = ee.Image.pixelArea().divide(1e4).addBands(severidad)
  .updateMask(severidad.gt(0))
  .reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'clase'}),
    geometry: aoi, scale: ESCALA, maxPixels: 1e10
  });
var tablaSev = ee.FeatureCollection(ee.List(porClase.get('groups')).map(function (g) {
  g = ee.Dictionary(g);
  var nombres = ee.List(['', 'Baja', 'Moderada-baja', 'Moderada-alta', 'Alta']);
  return ee.Feature(null, {clase: nombres.get(ee.Number(g.get('clase'))), ha: g.get('sum')});
}));
print('5. Hectáreas por clase de severidad:', tablaSev);
print(ui.Chart.feature.byFeature({features: tablaSev, xProperty: 'clase', yProperties: ['ha']})
  .setChartType('ColumnChart')
  .setOptions({title: '5. Hectáreas por clase de severidad', legend: {position: 'none'},
               colors: ['f46d43']}));

// ===== 6. LEYENDA DE SEVERIDAD ===============================================
var leyenda = ui.Panel({style: {position: 'bottom-left', padding: '8px 12px'}});
leyenda.add(ui.Label('Severidad (dNBR)', {fontWeight: 'bold'}));
['Baja', 'Moderada-baja', 'Moderada-alta', 'Alta'].forEach(function (nombre, i) {
  leyenda.add(ui.Panel([
    ui.Label('', {backgroundColor: '#' + PALETA_SEV[i + 1], padding: '8px', margin: '0 6px 4px 0'}),
    ui.Label(nombre, {margin: '0 0 4px 0'})
  ], ui.Panel.Layout.flow('horizontal')));
});
Map.add(leyenda);
