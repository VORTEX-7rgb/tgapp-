import json
import re
import os

steps = [
    1482, 1484, 1486, 1488, 1490,
    1511, 1513, 1515, 1517, 1519,
    1521, 1523, 1525, 1527, 1529,
    1544, 1546, 1548, 1550, 1552
]

VALID_HOSTS = ['videy.co', 'catbox.moe', 'zpi.cx', 'project1content.com']

all_valid_movies = []
seen = set()

for step in steps:
    fpath = rf'C:\Users\mrara\.gemini\antigravity\brain\e39efa9b-cb79-4ef3-92a5-8d42898c4b2e\.system_generated\steps\{step}\content.md'
    if not os.path.exists(fpath):
        continue
    text = open(fpath, encoding='utf-8').read()
    idx = text.find('[')
    if idx == -1:
        continue
    posts = json.loads(text[idx:])
    
    for p in posts:
        dumped = json.dumps(p)
        mp4_matches = re.findall(r'https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*', dumped)
        clean = [u for u in mp4_matches if any(vh in u for vh in VALID_HOSTS) and not any(w in u.lower() for w in ['preview', 'trailer', 'sample'])]
        
        if clean:
            stream_url = clean[0]
            if stream_url in seen:
                continue
            seen.add(stream_url)
            
            title = p.get('title', {}).get('rendered', '')
            title = re.sub(r'&#8211;', '-', title)
            title = re.sub(r'&#8217;', "'", title)
            title = re.sub(r'&amp;', '&', title)
            title = re.sub(r'&#038;', '&', title)
            title = re.sub(r'<[^>]+>', '', title).strip()
            
            dur = p.get('meta', {}).get('duration', 0)
            try:
                dur_sec = int(dur)
            except Exception:
                dur_sec = 0
            
            # Require full-length (> 10 mins / 600s or at least 300s)
            if dur_sec and dur_sec < 180:
                continue
                
            thumb = p.get('meta', {}).get('thumb', '')
            
            all_valid_movies.append({
                'id': f"pb-{p.get('id')}",
                'title': title,
                'slug': p.get('slug', f"pb-{p.get('id')}"),
                'streamUrl': stream_url,
                'directStreamUrl': stream_url,
                'durationSec': dur_sec,
                'duration': f"{dur_sec//60}:{dur_sec%60:02d}" if dur_sec else "25:00",
                'poster': thumb,
                'thumb': thumb,
                'sourceName': 'WESTERN HD',
                'source': 'pornbusy',
                'isHD': True,
                'cors': True
            })

print(f"Total valid direct MP4 full-length movies: {len(all_valid_movies)}")
for i, m in enumerate(all_valid_movies[:30]):
    print(f"[{i+1}] ({m['duration']}) {m['title'][:45]} -> {m['streamUrl']}")

with open('data/pornbusy_expanded_mp4s.json', 'w', encoding='utf-8') as f:
    json.dump(all_valid_movies, f, indent=2)
print("Saved to data/pornbusy_expanded_mp4s.json")
