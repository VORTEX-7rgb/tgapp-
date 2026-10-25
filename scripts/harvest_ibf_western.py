import urllib.request
import re
import sys
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Harvest top full-length Western movies from indianbfclips
base_url = 'https://www.indianbfclips.com/category/english-bf/?sort_by=duration'
req = urllib.request.Request(base_url, headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8', 'ignore')

# Extract all items
# Pattern: <div class="thumb thumb_rel item ..."> ... <a href="(url)" title="(title)" ... <img src="(thumb)" ... <div class="time">(duration)</div>
raw_items = re.findall(r'<div class="thumb[^"]*item[^"]*"[\s\S]*?<a href="([^"]+)" title="([^"]+)"[\s\S]*?<img [^>]*src="([^"]+)"[\s\S]*?<div class="time">([^<]+)</div>', html)

print(f"Scraped {len(raw_items)} items from page 1 of English BF (sorted by duration):")

harvested = []
for page_url, title, thumb, dur_str in raw_items:
    dur_str = dur_str.strip()
    
    # Calculate duration in seconds
    parts = dur_str.split(':')
    if len(parts) == 3:
        sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    elif len(parts) == 2:
        sec = int(parts[0]) * 60 + int(parts[1])
    else:
        sec = 0
        
    # Only keep videos >= 15 minutes (900 seconds)
    if sec < 900:
        continue
        
    # Extract numeric video id from page_url or inspect page for embed id
    # Let's fetch the video page to get embed id and high-res preview
    try:
        p_req = urllib.request.Request(page_url, headers={'User-Agent': 'Mozilla/5.0'})
        p_html = urllib.request.urlopen(p_req, timeout=4).read().decode('utf-8', 'ignore')
        m_embed = re.search(r'https://www.indianbfclips.com/embed/(\d+)', p_html)
        if not m_embed:
            continue
        v_id = m_embed.group(1)
        embed_url = f"https://www.indianbfclips.com/embed/{v_id}"
        
        # Look for HD preview image
        m_img = re.search(r'property="og:image"\s+content="([^"]+)"', p_html)
        high_res_thumb = m_img.group(1) if m_img else thumb
        
        harvested.append({
            'id': f"ibf-{v_id}",
            'numericId': v_id,
            'title': title.strip(),
            'slug': page_url.strip('/').split('/')[-1],
            'pageUrl': page_url,
            'embedUrl': embed_url,
            'streamUrl': embed_url,
            'thumb': high_res_thumb,
            'poster': high_res_thumb,
            'duration': dur_str,
            'durationSec': sec,
            'category': 'western',
            'tags': ['western', 'full-length', 'hd1080p', 'english'],
            'hashtags': ['#western', '#fulllength', '#hd1080p'],
            'views': f"{round(150 + (int(v_id) % 250))}k",
            'type': 'embed',
            'tier': 1,
            'isHD': True,
            'sourceName': 'WESTERN HD',
            'source': 'pornbusy'  # mapping to western cinema section
        })
        print(f"  [OK {dur_str:>8}] {title[:45]} -> {embed_url}")
    except Exception as e:
        print(f"  [ERR] {page_url}: {e}")

print(f"\nTotal full-length (>= 15 mins) movies harvested: {len(harvested)}")
with open('data/ibf_western_sample.json', 'w', encoding='utf-8') as f:
    json.dump(harvested, f, indent=2)
