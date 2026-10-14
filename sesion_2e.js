/*******************************************************************************
 * APAIT · Proyecto GEE · Sesión 2 · Demo 2.4b
 * CARTOGRAFÍA DE INUNDACIÓN CON SENTINEL-1 (SAR)
 *
 * Ejemplo: inundaciones de Emilia-Romaña (Italia), 16–17 de mayo de 2023.
 * Llanura entre Faenza (44.286 N, 11.883 E), Lugo (44.417 N, 11.917 E),
 * Sant'Agata sul Santerno (44.433 N, 11.867 E) y Conselice.
 ******************************************************************************/

// ===== 0. ZONA DE ESTUDIO Y PARÁMETROS ======================================
var aoi = ee.Geometry.Polygon([[
  [11.72, 44.27], [12.08, 44.27], [12.08, 44.58], [11.72, 44.58], [11.72, 44.27]
]]);
var PRE  = ['2023-04-20', '2023-05-10'];   // referencia seca
var POST = ['2023-05-17', '2023-05-26'];   // se usará la primera pasada tras el pico
var ESCALA = 20;
var CAIDA_DB = 3;                          // descenso mínimo de VV (dB)

Map.centerObject(aoi, 11);
Map.addLayer(ee.Image().paint(aoi, 0, 2), {palette: ['yellow']}, '0. AOI');

// ===== 1. COLECCIÓN SENTINEL-1 GRD ==========================================
// En GEE ya viene calibrado, con corrección de terreno y en decibelios (dB)
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .select('VV');

var pasadas = s1.filterDate(PRE[0], POST[1]);
print('1. Fechas de las pasadas:', pasadas.aggregate_array('system:time_start')
  .map(function (t) { return ee.Date(t).format('YYYY-MM-dd HH:mm'); }));
print('1. Sentido de la órbita:', pasadas.aggregate_array('orbitProperties_pass'));
print('1. Órbita relativa:', pasadas.aggregate_array('relativeOrbitNumber_start'));

// ===== 2. MISMA GEOMETRÍA DE ADQUISICIÓN EN PRE Y POST =======================
// Se toma la órbita relativa de la primera pasada post y se usa también en pre
var primeraPost = ee.Image(s1.filterDate(POST[0], POST[1]).sort('system:time_start').first());
var orbita = primeraPost.get('relativeOrbitNumber_start');
var fechaPost = ee.Date(primeraPost.get('system:time_start'));
print('2. Órbita elegida:', orbita, 'Fecha post:', fechaPost.format('YYYY-MM-dd'));

var s1Orb = s1.filter(ee.Filter.eq('relativeOrbitNumber_start', orbita));

// Pre: mediana de varias pasadas secas (reduce ruido)
var vvPre = s1Orb.filterDate(PRE[0], PRE[1]).median().clip(aoi);
// Post: mosaico de las escenas de ese día y esa órbita (el agua baja en días)
var vvPost = s1Orb.filterDate(fechaPost, fechaPost.advance(1, 'day')).mosaic().clip(aoi);
print('2. Nº de pasadas en la mediana pre:', s1Orb.filterDate(PRE[0], PRE[1]).size());

var visVV = {min: -25, max: 0};
Map.addLayer(ee.Image(s1Orb.filterDate(PRE[0], PRE[1]).first()).clip(aoi), visVV,
  '2a. Una pasada pre suelta (speckle visible)', false);
Map.addLayer(vvPre,  visVV, '2b. VV pre, mediana (dB)');
Map.addLayer(vvPost, visVV, '2c. VV post (dB)');

// Composición multitemporal: el agua nueva sale en rojo
Map.addLayer(ee.Image.cat([vvPre, vvPost, vvPost]), visVV, '2d. RGB pre/post/post (agua nueva en rojo)');

// ===== 3. FILTRO DEL SPECKLE ================================================
var suav = function (img) { return img.focalMedian(50, 'circle', 'meters'); };
var vvPreS  = suav(vvPre);
var vvPostS = suav(vvPost);
Map.addLayer(vvPostS, visVV, '3. VV post filtrado (mediana 50 m)', false);

// ===== 4. CAMBIO ENTRE FECHAS ===============================================
// En dB, la resta equivale al logaritmo del cociente post/pre
var cambio = vvPostS.subtract(vvPreS).rename('cambio');
Map.addLayer(cambio, {min: -8, max: 8, palette: ['0000ff', 'ffffff', 'ff0000']},
  '4. Cambio VV post − pre (dB; azul = baja la señal)');

// ===== 5. HISTOGRAMA Y UMBRAL DE OTSU SOBRE VV POST ==========================
print(ui.Chart.image.histogram({
  image: vvPostS, region: aoi, scale: ESCALA, maxBuckets: 200, maxPixels: 1e9
}).setOptions({
  title: '5. Histograma de VV post (dB): el pico izquierdo es agua',
  hAxis: {title: 'VV (dB)'}, legend: {position: 'none'}
}));

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

var umbralVV = ee.Number(otsu(vvPostS.reduceRegion({
  reducer: ee.Reducer.histogram(255, 0.1),
  geometry: aoi, scale: ESCALA, maxPixels: 1e10, bestEffort: true
}).get('VV')));
print('5. Umbral de Otsu para VV post (dB):', umbralVV,
      '(orientativo en la bibliografía: −16 a −18 dB)');

// ===== 6. CONDICIONES POR SEPARADO ==========================================
var aguaPost = vvPostS.lt(umbralVV).rename('m');            // superficie lisa en post
var caida    = cambio.lt(-CAIDA_DB).rename('m');           // la señal bajó
var aguaPerm = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence')
  .gt(80).unmask(0).clip(aoi);                             // ríos, balsas, lagunas
var pendiente = ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003')).clip(aoi);
var llano = pendiente.lt(5);                               // fuera laderas y sombras radar

Map.addLayer(aguaPost.selfMask(), {palette: ['00ffff']}, '6a. Agua en post (VV < Otsu)', false);
Map.addLayer(caida.selfMask(),    {palette: ['ff00ff']}, '6b. Caída > 3 dB', false);
Map.addLayer(aguaPerm.selfMask(), {palette: ['000080']}, '6c. Agua permanente (JRC)', false);
Map.addLayer(llano.not().selfMask(), {palette: ['8b4513']}, '6d. Pendiente ≥ 5° (descartada)', false);

// ===== 7. INUNDACIÓN FINAL ==================================================
var inundado = aguaPost.and(caida).and(aguaPerm.not()).and(llano).rename('m');
// Limpieza: quitar grupos menores de 10 píxeles (0,4 ha a 20 m)
var tam = inundado.selfMask().connectedPixelCount({maxSize: 50, eightConnected: true});
var inundadoLimpio = inundado.updateMask(tam.gte(10)).selfMask();
Map.addLayer(inundadoLimpio, {palette: ['0000ff']}, '7. Zona inundada');

var haInundado = inundadoLimpio.multiply(ee.Image.pixelArea()).divide(1e4).reduceRegion({
  reducer: ee.Reducer.sum(), geometry: aoi, scale: ESCALA, maxPixels: 1e10
}).get('m');
print('7. Superficie inundada (ha):', haInundado);

// ===== 8. LIMITACIÓN: ZONAS URBANAS =========================================
// En ciudades el agua entre edificios produce doble rebote y la señal SUBE.
var urbano = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').eq(50).clip(aoi);
Map.addLayer(urbano.selfMask(), {palette: ['808080']}, '8a. Zonas urbanas (WorldCover)', false);
Map.addLayer(cambio.gt(CAIDA_DB).and(urbano).selfMask(), {palette: ['ff0000']},
  '8b. Urbano donde la señal SUBE > 3 dB (posible agua no detectada)', false);
