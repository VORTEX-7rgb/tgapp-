/**
 * scrape_upskirt_trending.js
 * 
 * Curated Ingestion Engine for UpSkirt.tv:
 * 1. Scrapes ONLY /top, /best, and high-demand trending tags (Indian, MILF, Rough Sex, Big Ass, etc.)
 * 2. Applies intelligent NLP taxonomy & regex tag rules
 * 3. Enriches each item with high-engagement hashtags (#Trending #Best #MILF #Blowjob #HD)
 * 4. Extracts views, duration, hover MP4 preview, and rating
 * 5. Deduplicates safely against existing data/upskirt_catalog.json
 */

const fs = require('fs');
const path = require('path');
const { fetchUpskirt, parseListing } = require('../upskirt_scraper');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'upskirt_catalog.json');

// Taxonomy Rules for UpSkirt Content
const TAG_RULES = [
  { tag: 'indian', name: 'Indian & Desi', regex: /\b(indian|desi|bhabhi|aunty|malayalam|tamil|pakistani|south-asian|hindi)\b/i },
  { tag: 'milf', name: 'MILF & Mature', regex: /\b(milf|mature|mom|stepmom|wife|housewife|cougar|padosan)\b/i },
  { tag: 'rough-sex', name: 'Rough & Hardcore', regex: /\b(rough|hardcore|hard|pounded|throat|choke|destroy|intense|raw)\b/i },
  { tag: 'big-ass', name: 'Big Ass & Curvy', regex: /\b(big-ass|ass|booty|thick|pawg|bubble|butt|curvy|fat-ass)\b/i },
  { tag: 'blowjob', name: 'Oral & Blowjob', regex: /\b(blowjob|bj|oral|sucking|suck|deepthroat|throat|head|swallow)\b/i },
  { tag: 'amateur', name: 'Amateur & Homemade', regex: /\b(amateur|homemade|local|couple|gf|boyfriend|selfie|real)\b/i },
  { tag: 'creampie', name: 'Creampie & Cum', regex: /\b(creampie|cum|cream|internal|breeding|load|drip)\b/i },
  { tag: 'anal', name: 'Anal', regex: /\b(anal|backdoor|assfuck|ass-fuck|butt)\b/i },
  { tag: 'solo', name: 'Solo & Tease', regex: /\b(solo|tease|strip|fingering|masturbat|dildo|vibrator|toy)\b/i },
  { tag: 'doggystyle', name: 'Doggystyle', regex: /\b(doggy|doggystyle|behind|from-behind)\b/i },
  { tag: 'teen', name: '18+ College & Teen', regex: /\b(teen|18|19|college|student|young)\b/i },
  { tag: 'straight', name: 'Passionate & Straight', regex: /\b(straight|sensual|romance|romantic|lovers)\b/i }
];

function extractTaxonomy(title = '', slug = '', sourceCategory = '') {
  const combined = `${title} ${slug} ${sourceCategory}`.toLowerCase();
  const tags = new Set();
  const hashtags = new Set(['#Trending', '#Best', '#HD']);

  if (sourceCategory && sourceCategory !== 'top' && sourceCategory !== 'best') {
    tags.add(sourceCategory);
    hashtags.add(`#${sourceCategory.charAt(0).toUpperCase() + sourceCategory.slice(1).replace(/-/g, '')}`);
  }

  for (const rule of TAG_RULES) {
    if (rule.regex.test(combined)) {
      tags.add(rule.tag);
      hashtags.add(`#${rule.tag.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`);
    }
  }

  if (tags.size === 0) {
    tags.add('trending');
  }

  const primaryCategory = Array.from(tags)[0] || 'trending';

  return {
    category: primaryCategory,
    tags: Array.from(tags),
    hashtags: Array.from(hashtags).slice(0, 6).join(' ')
  };
}

function parseViewsAndRating(stats = '') {
  let rating = '80%';
  let views = '1.2k';

  if (!stats) return { rating, views };

  const ratingMatch = stats.match(/(\d+)%/);
  if (ratingMatch) rating = `${ratingMatch[1]}%`;

  const viewsMatch = stats.match(/(\d[\d,.]*)\s*views/i);
  if (viewsMatch) {
    const rawNum = parseInt(viewsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(rawNum)) {
      views = rawNum >= 1000 ? `${(rawNum / 1000).toFixed(1)}k` : `${rawNum}`;
    }
  }
  return { rating, views };
}

async function scrapeTarget(path, categoryLabel) {
  try {
    console.log(`[Scraping] Fetching ${path} (${categoryLabel})...`);
    const html = await fetchUpskirt(path);
    const res = parseListing(html);
    console.log(`  -> Found ${res.videos.length} videos on ${path}`);
    return res.videos.map(v => {
      const taxonomy = extractTaxonomy(v.title, v.slug, categoryLabel);
      const { rating, views } = parseViewsAndRating(v.stats);
      return {
        ...v,
        type: 'mp4',
        streamUrl: `/api/ut/stream/${v.numericId}.mp4`,
        directStreamUrl: `/api/ut/stream/${v.numericId}.mp4`,
        category: taxonomy.category,
        tags: taxonomy.tags,
        hashtags: taxonomy.hashtags,
        rating,
        views,
        isTrending: true,
        sourceName: 'UpSkirt TV',
        scrapedAt: Date.now()
      };
    });
  } catch (err) {
    console.warn(`[Scraping Warning] Failed ${path}:`, err.message);
    return [];
  }
}

async function run() {
  console.log('====================================================');
  console.log('UPSKIRT.TV TRENDING & BEST INGESTION ENGINE');
  console.log('====================================================');

  let existing = [];
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      existing = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8') || '[]');
    }
  } catch (e) {
    existing = [];
  }
  console.log(`Existing UpSkirt catalog: ${existing.length} videos`);

  const catalogMap = new Map();
  existing.forEach(v => catalogMap.set(v.numericId, v));

  const targets = [
    // 1. All-time Top Rated Videos
    { path: '/top', label: 'top' },
    { path: '/best', label: 'best' },

    // 2. High-Demand Trending Niches
    { path: '/tags/indian', label: 'indian' },
    { path: '/tags/milf', label: 'milf' },
    { path: '/tags/rough-sex', label: 'rough-sex' },
    { path: '/tags/big-ass', label: 'big-ass' },
    { path: '/tags/blowjob', label: 'blowjob' },
    { path: '/tags/amateur', label: 'amateur' },
    { path: '/tags/pakistani', label: 'pakistani' },
    { path: '/tags/south-asian', label: 'south-asian' },
    { path: '/tags/straight', label: 'straight' }
  ];

  let addedCount = 0;
  let updatedCount = 0;

  for (const target of targets) {
    const items = await scrapeTarget(target.path, target.label);
    for (const item of items) {
      if (catalogMap.has(item.numericId)) {
        const current = catalogMap.get(item.numericId);
        catalogMap.set(item.numericId, { ...current, ...item });
        updatedCount++;
      } else {
        catalogMap.set(item.numericId, item);
        addedCount++;
      }
    }
    await new Promise(r => setTimeout(r, 350));
  }

  const finalCatalog = Array.from(catalogMap.values());
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(finalCatalog, null, 2), 'utf8');

  console.log('\n====================================================');
  console.log(`[COMPLETED] UpSkirt Catalog updated successfully!`);
  console.log(`  - New Trending Videos Added: ${addedCount}`);
  console.log(`  - Existing Videos Enriched:  ${updatedCount}`);
  console.log(`  - Total UpSkirt Catalog:     ${finalCatalog.length} videos`);
  console.log('====================================================\n');
}

if (require.main === module) {
  run().catch(e => console.error('[Fatal Error]:', e));
}

module.exports = { run };
