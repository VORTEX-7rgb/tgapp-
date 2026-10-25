const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'viralmms_catalog.json');
const BACKUP_PATH = path.join(__dirname, '..', 'data', 'viralmms_catalog.backup.json');

const TAG_RULES = [
  { slug: 'oral', name: '👄 Oral & Blowjob', priority: 10, regex: /\b(oral|blowjob|blow|suck|sucking|mouth|deepthroat|choke|swallow|facefuck)\b/i },
  { slug: 'bhabhi', name: '🧕 Bhabhi & Devar', priority: 10, regex: /\b(bhabhi|bhabi|boudhi|devar|devar-bhabhi)\b/i },
  { slug: 'aunty', name: '🧓 Aunty & Milf', priority: 10, regex: /\b(aunty|auntie|milf|mature|housewife|wife|married|padosan)\b/i },
  { slug: 'college', name: '🎓 College & Teen', priority: 9, regex: /\b(college|student|hostel|pg|roommate|teen|young|18|19|coaching|school)\b/i },
  { slug: 'village', name: '🌾 Village & Dehati', priority: 9, regex: /\b(village|dehati|jungli|adivasi|farmer|outdoor|jungle|farm|khet)\b/i },
  { slug: 'solo', name: '🤳 Solo & Cam', priority: 8, regex: /\b(solo|selfie|masturbat|finger|fingering|vibrator|strip|strips|stripping|dance|videocall|call|webcam|cam)\b/i },
  { slug: 'cum', name: '💦 Cum & Creampie', priority: 8, regex: /\b(cum|cumshot|creampie|facial|drip|dripping|load)\b/i },
  { slug: 'boobs', name: '🍈 Boobs & Pressing', priority: 7, regex: /\b(boob|boobs|busty|melons|milky|cleavage|pressing|press|squeeze|squeezing|tit|tits|titjob)\b/i },
  { slug: 'doggystyle', name: '🐕 Doggystyle', priority: 7, regex: /\b(doggy|doggystyle|behind|riding|ride|bouncing|cowgirl)\b/i },
  { slug: 'anal', name: '🍑 Anal & Back', priority: 7, regex: /\b(anal|ass|asshole|butt|backdoor)\b/i },
  { slug: 'hotel', name: '🏨 Hotel & OYO', priority: 6, regex: /\b(hotel|oyo|room|bathroom|shower|bath|kitchen|office|car|lodge)\b/i },
  { slug: 'amateur', name: '❤️ Amateur Couple', priority: 6, regex: /\b(amateur|homemade|local|couple|gf|bf|lover|romance|romantic|girlfriend|boyfriend)\b/i },
  { slug: 'punjabi', name: '🌾 Punjabi', priority: 8, regex: /\b(punjabi|ludhiana|chandigarh|sikh)\b/i },
  { slug: 'tamil', name: '🌴 Tamil & South', priority: 8, regex: /\b(tamil|chennai|madurai|vellore|south|kannada)\b/i },
  { slug: 'mallu', name: '🌊 Mallu & Telugu', priority: 8, regex: /\b(mallu|kerala|telugu|hyderabad|andhra)\b/i },
  { slug: 'bangla', name: '🐟 Bangla & Bengali', priority: 8, regex: /\b(bangla|bengali|kolkata|bong|bangladeshi|assam|assamese|guwahati)\b/i },
  { slug: 'bhojpuri', name: '🪕 Bhojpuri', priority: 8, regex: /\b(bhojpuri|bihari|patna|up|bihar)\b/i },
  { slug: 'pakistani', name: '🏔️ Pakistani & Kashmiri', priority: 8, regex: /\b(pakistani|paki|lahore|karachi|muslim|hijabi|kashmiri)\b/i },
  { slug: 'hardcore', name: '💥 Hardcore & Rough', priority: 5, regex: /\b(hardcore|rough|fuck|fucked|fucking|drilling|pounded|pounding|destroy|destroying|screaming|moaning)\b/i }
];

function classify(video) {
  const text = ((video.title || '') + ' ' + (video.slug || '') + ' ' + (video.category || '')).toLowerCase();
  const matchedRules = [];
  const tags = new Set(['desi', 'viralmms']);

  for (const rule of TAG_RULES) {
    if (rule.regex.test(text)) {
      matchedRules.push(rule);
      tags.add(rule.slug);
    }
  }

  // Determine primary category by rule priority
  matchedRules.sort((a, b) => b.priority - a.priority);
  const primaryCategory = matchedRules.length > 0 ? matchedRules[0].slug : 'desi';

  const tagsArr = Array.from(tags);
  const hashtags = tagsArr.map(t => '#' + t.charAt(0).toUpperCase() + t.slice(1));

  return {
    category: primaryCategory,
    tags: tagsArr,
    hashtags
  };
}

function enrichCatalog() {
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const items = JSON.parse(raw);
  console.log(`Loaded ${items.length} items from ${CATALOG_PATH}`);

  // Create backup
  fs.writeFileSync(BACKUP_PATH, raw, 'utf8');
  console.log(`Backup created at ${BACKUP_PATH}`);

  const enriched = items.map((item, idx) => {
    const { category, tags, hashtags } = classify(item);
    return {
      ...item,
      category,
      tags,
      hashtags,
      sourceName: 'ViralMMS',
      source: 'viralmms',
      tier: 1,
      type: 'mp4',
      duration: item.duration || (8 + (idx % 18)) + ':00'
    };
  });

  const tmpPath = `${CATALOG_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(enriched, null, 2), 'utf8');
  fs.renameSync(tmpPath, CATALOG_PATH);

  console.log(`Successfully enriched ${enriched.length} items in ${CATALOG_PATH}`);
  console.log('Sample enriched item:', enriched[0]);
}

enrichCatalog();
