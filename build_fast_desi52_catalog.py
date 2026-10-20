"""
High-Speed Desi52 Verified Catalog Builder
ONLY ingests verified, high-speed Playmate direct-CORS streams.
Strictly purges and discards all LuluVdo (tnmr.org), Streamfile, and slow/dead cyberlockers.
"""
import os
import re
import json
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

CATALOG_PATH = os.path.join(os.path.dirname(__file__), 'data', 'verified_catalog.json')
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
}

def load_existing():
    if not os.path.exists(CATALOG_PATH):
        return []
    try:
        with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Retain ONLY fast Playmate streams (purge all tnmr.org / luluvdo)
            fast_only = [v for v in data if v.get('rawUrl') and 'plauymito.live' in v.get('rawUrl')]
            print(f"[Init] Loaded {len(data)} items, kept {len(fast_only)} fast Playmate items, purged {len(data) - len(fast_only)} slow/Lulu items.")
            return fast_only
    except Exception as e:
        print(f"[Init Error]: {e}")
        return []

def save_catalog(videos):
    os.makedirs(os.path.dirname(CATALOG_PATH), exist_ok=True)
    with open(CATALOG_PATH, 'w', encoding='utf-8') as f:
        json.dump(videos, f, indent=2, ensure_ascii=False)
    print(f"[Save] Saved {len(videos)} 100% verified fast Playmate videos to {CATALOG_PATH}")

def fetch_page_cards(page_url, category_slug=""):
    try:
        r = requests.get(page_url, headers=headers, timeout=10)
        if r.status_code != 200:
            return []
        html = r.text
        
        cards = []
        article_matches = re.findall(r'<article\b[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)</article>', html, re.I)
        for block in article_matches:
            link_match = re.search(r'<a\b[^>]*href="(https://desi52\.watch/[^"]+/)"[^>]*title="([^"]+)"', block, re.I) or \
                         re.search(r'<a\b[^>]*title="([^"]+)"[^>]*href="(https://desi52\.watch/[^"]+/)"', block, re.I)
            if not link_match:
                continue
            
            url = link_match.group(1) if link_match.group(1).startswith('http') else link_match.group(2)
            title = link_match.group(2) if link_match.group(1).startswith('http') else link_match.group(1)
            
            thumb_match = re.search(r'data-main-thumb="([^"]+)"', block, re.I) or \
                          re.search(r'<img\b[^>]*src="([^"]+)"', block, re.I) or \
                          re.search(r'data-src="([^"]+)"', block, re.I)
            raw_thumb = thumb_match.group(1) if thumb_match else ''
            
            dur_match = re.search(r'<span\b[^>]*class="[^"]*duration[^"]*"[^>]*>([\s\S]*?)</span>', block, re.I)
            duration = re.sub(r'<[^>]+>', '', dur_match.group(1)).strip() if dur_match else ''
            
            views_match = re.search(r'<span\b[^>]*class="[^"]*views[^"]*"[^>]*>([\s\S]*?)</span>', block, re.I)
            views = re.sub(r'<[^>]+>', '', views_match.group(1)).strip() if views_match else ''
            
            is_hd = bool(re.search(r'class="[^"]*hd-video[^"]*"', block, re.I))
            slug_match = re.search(r'desi52\.watch/([^/]+)/?', url)
            vid_id = slug_match.group(1) if slug_match else url.replace('/', '_')
            
            cards.append({
                'id': vid_id,
                'title': title,
                'url': url,
                'rawThumb': raw_thumb,
                'duration': duration,
                'views': views,
                'isHD': is_hd,
                'category': category_slug
            })
        return cards
    except Exception as e:
        print(f"[Error] Fetching page {page_url}: {e}")
        return []

def resolve_playmate_video(card):
    try:
        post_url = card['url']
        r = requests.get(post_url, headers=headers, timeout=8)
        if r.status_code != 200:
            return None
        
        # Look for playmate iframe or watch link
        pm_match = re.search(r'playmate\.to/(?:embed|watch)/([a-zA-Z0-9]+)', r.text, re.I)
        if not pm_match:
            # If it's luluvdo, streamfile, or dead, return None
            return None
        
        filecode = pm_match.group(1)
        api_res = requests.post('https://playmate.to/api/s', json={'c': filecode, 'd': 'desktop'}, headers={
            'Referer': f'https://playmate.to/embed/{filecode}',
            'Origin': 'https://playmate.to',
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json'
        }, timeout=8)
        
        if api_res.status_code != 200:
            return None
        
        data = api_res.json()
        sx = data.get('sx')
        if not sx or 'plauymito.live' not in sx:
            return None
        
        # Quick check that master playlist responds
        chk = requests.get(sx, headers={'User-Agent': USER_AGENT}, timeout=6)
        if chk.status_code != 200 or '#EXTM3U' not in chk.text:
            return None
        
        poster = data.get('ix') or card['rawThumb']
        thumb = f"/api/thumb?url={requests.utils.quote(card['rawThumb'])}" if card['rawThumb'] else poster
        
        return {
            'ok': True,
            'id': card['id'],
            'title': card['title'],
            'url': card['url'],
            'thumb': thumb,
            'duration': card['duration'],
            'views': card['views'],
            'isHD': card['isHD'],
            'streamUrl': f"/api/live.m3u8?url={requests.utils.quote(sx)}",
            'rawUrl': sx,
            'poster': poster,
            'category': card.get('category', ''),
            'verifiedAt': int(time.time() * 1000)
        }
    except Exception:
        return None

def main():
    existing_catalog = load_existing()
    existing_urls = {v['url'] for v in existing_catalog}
    
    # 1. Collect pages
    pages_to_crawl = []
    # Browse latest pages 1 to 20
    for p in range(1, 21):
        url = 'https://desi52.watch/' if p == 1 else f'https://desi52.watch/page/{p}/'
        pages_to_crawl.append((url, ''))
    
    # Categories
    categories = ['18-web-series', 'indian-desi-mms', 'desi-cute-girls-videos', 'bangla-sex-videos', 'arab-sex-videos']
    for cat in categories:
        for p in range(1, 6):
            url = f'https://desi52.watch/category/{cat}/' if p == 1 else f'https://desi52.watch/category/{cat}/page/{p}/'
            pages_to_crawl.append((url, cat))
    
    print(f"[Crawler] Scanning {len(pages_to_crawl)} listing pages...")
    all_cards = []
    card_urls = set()
    
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(fetch_page_cards, url, cat): (url, cat) for url, cat in pages_to_crawl}
        for fut in as_completed(futures):
            cards = fut.result()
            for c in cards:
                if c['url'] not in card_urls and c['url'] not in existing_urls:
                    card_urls.add(c['url'])
                    all_cards.append(c)
    
    print(f"[Crawler] Discovered {len(all_cards)} new unique candidate posts to test.")
    
    # 2. Test and filter candidates in parallel (keep ONLY fast Playmate)
    verified_new = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(resolve_playmate_video, card): card for card in all_cards}
        for fut in as_completed(futures):
            res = fut.result()
            if res:
                verified_new.append(res)
                print(f"[Fast Match #{len(verified_new)}] {res['title'][:45]} -> {res['rawUrl'][:55]}")
                if len(verified_new) % 10 == 0:
                    combined = existing_catalog + verified_new
                    save_catalog(combined)
    
    final_catalog = existing_catalog + verified_new
    # Re-index titles to look clean
    for idx, v in enumerate(final_catalog):
        if not v['title'] or v['title'].startswith('Video '):
            v['title'] = f"Video {idx + 1}"
    
    save_catalog(final_catalog)
    print(f"\n==========================================")
    print(f"🎉 Desi52 Fast-Only Catalog Ready: {len(final_catalog)} videos")
    print(f"==========================================")

if __name__ == '__main__':
    main()
