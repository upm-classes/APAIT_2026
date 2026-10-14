/*******************************************************************************
 * APAIT · Proyecto GEE · Sesión 2 · Demo 2.4a
 * LIMPIEZA MORFOLÓGICA Y MÁSCARAS AUXILIARES
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
var MIN_PIXELES = 25;                        // 25 píxeles de 20 m = 1 ha

Map.centerObject(aoi, 10);
Map.addLayer(ee.Image().paint(aoi, 0, 2), {palette: ['yellow']}, '0. AOI');

// ===== 1. dNBR Y MÁSCARA BRUTA (umbral de Otsu) ==============================
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

var pre  = compositeS2(PRE);
var post = compositeS2(POST);
Map.addLayer(post, {bands: ['B12', 'B8', 'B4'], min: 0, max: 0.4}, '1a. Composite POST (SWIR)', false);

var dNBR = pre.normalizedDifference(['B8', 'B12'])
  .subtract(post.normalizedDifference(['B8', 'B12'])).rename('dNBR');
var umbral = ee.Number(otsu(dNBR.reduceRegion({
  reducer: ee.Reducer.histogram(255, 0.01),
  geometry: aoi, scale: ESCALA, maxPixels: 1e10, bestEffort: true
}).get('dNBR')));
print('1. Umbral de Otsu:', umbral);

// unmask(0): los píxeles sin dato pasan a 0 para que la morfología funcione
var bruta = dNBR.gt(umbral).unmask(0).clip(aoi).rename('m');
Map.addLayer(bruta.selfMask(), {palette: ['ffff00']}, '1b. Máscara bruta');

// Función auxiliar: hectáreas de una máscara 0/1
function ha(mascara) {
  return ee.Number(mascara.rename('m').selfMask().multiply(ee.Image.pixelArea()).divide(1e4)
    .reduceRegion({reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA, maxPixels: 1e10})
    .get('m')).round();
}
print('1. ha máscara bruta:', ha(bruta));

// ===== 2. FILTRO DE MODA 3x3 ================================================
// Cada píxel toma el valor mayoritario de su vecindad: quita ruido sal y pimienta
var moda = bruta.focalMode({radius: 1, kernelType: 'square', units: 'pixels'});
Map.addLayer(moda.selfMask(), {palette: ['ff8c00']}, '2. Moda 3x3');
print('2. ha tras moda:', ha(moda));

// ===== 3. EROSIÓN, DILATACIÓN, APERTURA Y CIERRE ==============================
var erosion    = bruta.focalMin({radius: 1, kernelType: 'square', units: 'pixels'});
var dilatacion = bruta.focalMax({radius: 1, kernelType: 'square', units: 'pixels'});
var apertura   = erosion.focalMax({radius: 1, kernelType: 'square', units: 'pixels'});    // quita salientes
var cierre     = dilatacion.focalMin({radius: 1, kernelType: 'square', units: 'pixels'}); // rellena huecos
Map.addLayer(erosion.selfMask(),    {palette: ['800080']}, '3a. Erosión', false);
Map.addLayer(dilatacion.selfMask(), {palette: ['ff69b4']}, '3b. Dilatación', false);
Map.addLayer(apertura.selfMask(),   {palette: ['ff00ff']}, '3c. Apertura', false);
Map.addLayer(cierre.selfMask(),     {palette: ['00ced1']}, '3d. Cierre', false);
print('3. ha erosión / dilatación / apertura / cierre:',
  ha(erosion), ha(dilatacion), ha(apertura), ha(cierre));

// ===== 4. ELIMINAR GRUPOS PEQUEÑOS ==========================================
var tam = moda.selfMask().connectedPixelCount({maxSize: 100, eightConnected: true});
Map.addLayer(tam, {min: 1, max: 100, palette: ['ff0000', 'ffff00', '00ff00']},
  '4a. Píxeles por grupo (rojo = grupos pequeños)', false);
var limpia = moda.updateMask(tam.gte(MIN_PIXELES)).unmask(0).clip(aoi);
Map.addLayer(limpia.selfMask(), {palette: ['ff0000']}, '4b. Sin grupos < 1 ha');
print('4. ha sin grupos pequeños:', ha(limpia));

// ===== 5. MÁSCARAS AUXILIARES ===============================================
// 5a. Agua permanente (JRC): agua más del 80 % del tiempo
var aguaPerm = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence')
  .gt(80).unmask(0).clip(aoi);
Map.addLayer(aguaPerm.selfMask(), {palette: ['0000ff']}, '5a. Agua permanente (JRC)', false);

// 5b. Cobertura del suelo ESA WorldCover 2021 (10 m)
var wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').clip(aoi);
Map.addLayer(wc, {}, '5b. WorldCover (paleta oficial)', false);
// Clases que pueden arder: árboles (10), matorral (20), pastizal (30), cultivos (40)
var combustible = wc.eq(10).or(wc.eq(20)).or(wc.eq(30)).or(wc.eq(40));
Map.addLayer(combustible.selfMask(), {palette: ['228b22']}, '5c. Coberturas que pueden arder', false);
// Lo que se descarta: urbano (50), suelo desnudo (60), agua (80)...
Map.addLayer(limpia.and(combustible.not()).selfMask(), {palette: ['000000']},
  '5d. Quemado en coberturas descartadas', false);

// 5c. Relieve: sombreado y pendiente (útil en montaña y en SAR)
var mde = ee.Image('USGS/SRTMGL1_003');
Map.addLayer(ee.Terrain.hillshade(mde).clip(aoi), {min: 0, max: 255}, '5e. Sombreado del relieve', false);
Map.addLayer(ee.Terrain.slope(mde).clip(aoi), {min: 0, max: 40, palette: ['ffffff', 'ffa500', 'ff0000']},
  '5f. Pendiente (grados)', false);

// ===== 6. RESULTADO FINAL ===================================================
var final = limpia.and(aguaPerm.not()).and(combustible);
Map.addLayer(final.selfMask(), {palette: ['a50026']}, '6. Afectado final');
print('6. ha finales:', ha(final));

// Resumen: cuánto quita cada paso
var pasos = ee.FeatureCollection([
  ee.Feature(null, {paso: '1. Bruta',            ha: ha(bruta)}),
  ee.Feature(null, {paso: '2. Moda 3x3',         ha: ha(moda)}),
  ee.Feature(null, {paso: '4. Sin grupos < 1 ha', ha: ha(limpia)}),
  ee.Feature(null, {paso: '6. Con máscaras',     ha: ha(final)})
]);
print(ui.Chart.feature.byFeature({features: pasos, xProperty: 'paso', yProperties: ['ha']})
  .setChartType('ColumnChart')
  .setOptions({title: '6. Superficie tras cada paso de limpieza (ha)', legend: {position: 'none'},
               colors: ['a50026']}));
