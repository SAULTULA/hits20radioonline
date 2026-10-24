// /api/noticias.js
// Serverless Function de Vercel — Parsea feeds RSS directamente con rss-parser.
// Reemplaza la dependencia de rss2json.com, allorigins.win y codetabs.com.

const Parser = require('rss-parser');

// Fuentes RSS de noticias
const RSS_SOURCES = [
  'https://www.minutouno.com/rss.xml',
  'https://www.clarin.com/rss/lo-ultimo/',
  'https://tn.com.ar/rss.xml',
  'https://cnnespanol.cnn.com/feed/',
  'https://elchorrillero.com/feed/',
  'https://agenciasanluis.com/feed/',
];

// Mapa fuente → nombre legible
const SOURCE_NAMES = {
  'minutouno.com': 'Minuto Uno',
  'clarin.com': 'Clarín',
  'tn.com.ar': 'TN',
  'cnnespanol.cnn.com': 'CNN Español',
  'elchorrillero.com': 'El Chorrillero',
  'agenciasanluis.com': 'Agencia San Luis',
};

/**
 * Obtiene el nombre legible de la fuente a partir de la URL.
 * @param {string} url
 * @returns {string}
 */
function getSourceName(url) {
  for (const key in SOURCE_NAMES) {
    if (url.includes(key)) return SOURCE_NAMES[key];
  }
  return 'Noticias';
}

/**
 * Extrae la primera imagen disponible de un item RSS.
 * Intenta: enclosure, media:thumbnail, media:content, content snippet.
 * @param {object} item — Item crudo de rss-parser
 * @returns {string} URL de imagen o cadena vacía
 */
function extractThumbnail(item) {
  // enclosure (ej: Clarín)
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;

  // media:thumbnail (ej: BBC, El Chorrillero)
  if (item['media:thumbnail'] && item['media:thumbnail'].$.url)
    return item['media:thumbnail'].$.url;

  // media:content (ej: CNN Español)
  if (item['media:content'] && item['media:content'].$.url)
    return item['media:content'].$.url;

  // Iterable media:group → media:content
  if (item['media:group'] && item['media:group']['media:content']) {
    const mc = item['media:group']['media:content'];
    const first = Array.isArray(mc) ? mc[0] : mc;
    if (first && first.$ && first.$.url) return first.$.url;
  }

  // content (HTML embebido) → busca primer <img src="">
  const rawContent = item['content:encoded'] || item.content || '';
  const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

  return '';
}

/**
 * Parsea un feed RSS y devuelve hasta `limit` items normalizados.
 * @param {Parser} parser
 * @param {string} url
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchFeed(parser, url, limit = 5) {
  try {
    // Timeout manual de 7 segundos por feed
    const feedPromise = parser.parseURL(url);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 7000)
    );
    const feed = await Promise.race([feedPromise, timeoutPromise]);

    return (feed.items || []).slice(0, limit).map(item => ({
      title: (item.title || '').trim(),
      link: item.link || item.guid || '',
      thumbnail: extractThumbnail(item),
      pubDate: item.pubDate || item.isoDate || '',
      sourceName: getSourceName(url),
    })).filter(item => item.title && item.link);

  } catch (err) {
    // Feed falló — se reporta pero no rompe la respuesta global
    console.warn(`[noticias] Feed falló: ${url} →`, err.message);
    return [];
  }
}

/**
 * Handler principal de la Serverless Function.
 */
module.exports = async function handler(req, res) {
  // --- CORS: permite llamadas desde cualquier origen (es un sitio público) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Cache: 5 minutos en Vercel Edge, 10 minutos en CDN
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const parser = new Parser({
      timeout: 7000,
      // Campos extra que rss-parser no incluye por defecto
      customFields: {
        item: [
          ['media:thumbnail', 'media:thumbnail'],
          ['media:content', 'media:content'],
          ['media:group', 'media:group'],
          ['content:encoded', 'content:encoded'],
        ],
      },
    });

    // Fetch todas las fuentes en paralelo
    const results = await Promise.all(
      RSS_SOURCES.map(url => fetchFeed(parser, url, 5))
    );

    const working = [];
    const failed = [];

    RSS_SOURCES.forEach((url, i) => {
      if (results[i].length > 0) {
        working.push({ url, items: results[i] });
      } else {
        failed.push({ url });
      }
    });

    // Arma la lista final: 2 noticias por fuente que respondió
    let newsData = [];
    working.forEach(({ url, items }) => {
      items.slice(0, 2).forEach(item => newsData.push(item));
    });

    // Rellena con noticias extra si alguna fuente falló
    if (failed.length > 0) {
      const extras = [];
      working.forEach(({ items }) => {
        items.slice(2, 4).forEach(item => extras.push(item));
      });
      const needed = failed.length * 2;
      extras.slice(0, needed).forEach(item => newsData.push(item));
    }

    // Mezclar aleatoriamente y limitar a 6
    newsData = newsData
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);

    return res.status(200).json({
      ok: true,
      total: newsData.length,
      working: working.length,
      failed: failed.map(f => f.url),
      items: newsData,
    });

  } catch (err) {
    console.error('[noticias] Error crítico:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error interno al procesar los feeds RSS',
    });
  }
};
