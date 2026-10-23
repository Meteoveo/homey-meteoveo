/* The radar widget's own dictionaries (es, en, ca); the setting labels stay in
 * widget.compose.json. Tokens: __name__. */
(function (global) {
  'use strict';
  const es = {
    locale: 'es-ES',
    now: 'Ahora',
    forecast: '+__minutes__ min',
    age: 'radar de hace __minutes__ min',
    play: 'Reproducir',
    pause: 'Pausa',
    frame: 'Imagen de las __time__',
    frame_forecast: 'Previsión para dentro de __minutes__ min',
    legend: 'dBZ',
    credit: 'Radar: EUMETNET (OPERA) + AEMET · Relieve: AWS Terrain Tiles / Mapzen',
    loading: 'Cargando el radar…',
    unavailable: 'Ahora mismo el radar no está disponible',
    no_device: 'Añade antes una ubicación de MeteoVeo',
    no_coverage: 'Sin cobertura de radar en esta zona',
    no_frames: 'Todavía no hay imágenes de radar',
  };
  const en = {
    locale: 'en-GB',
    now: 'Now',
    forecast: '+__minutes__ min',
    age: 'radar from __minutes__ min ago',
    play: 'Play',
    pause: 'Pause',
    frame: 'Image from __time__',
    frame_forecast: 'Forecast for __minutes__ min ahead',
    legend: 'dBZ',
    credit: 'Radar: EUMETNET (OPERA) + AEMET · Relief: AWS Terrain Tiles / Mapzen',
    loading: 'Loading the radar…',
    unavailable: 'The radar is not available right now',
    no_device: 'Add a MeteoVeo location first',
    no_coverage: 'No radar coverage in this area',
    no_frames: 'No radar images yet',
  };
  const ca = {
    locale: 'ca-ES',
    now: 'Ara',
    forecast: '+__minutes__ min',
    age: 'radar de fa __minutes__ min',
    play: 'Reprodueix',
    pause: 'Pausa',
    frame: 'Imatge de les __time__',
    frame_forecast: "Previsió per d'aquí a __minutes__ min",
    legend: 'dBZ',
    credit: 'Radar: EUMETNET (OPERA) + AEMET · Relleu: AWS Terrain Tiles / Mapzen',
    loading: 'Carregant el radar…',
    unavailable: 'Ara mateix el radar no està disponible',
    no_device: 'Afegeix abans una ubicació de MeteoVeo',
    no_coverage: 'Sense cobertura de radar en aquesta zona',
    no_frames: 'Encara no hi ha imatges de radar',
  };
  global.MV_RADAR_I18N = { es, en, ca };
}(window));
