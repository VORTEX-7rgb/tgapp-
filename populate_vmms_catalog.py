import socket, ssl, time, re, json, urllib.request
from concurrent.futures import ThreadPoolExecutor

FORBIDDEN_KEYWORDS = [
    'sister', 'brother', 'family', 'taboo', 'bhai', 'behan', 'rape', 'forced', 'sleep', 'sleeping', 'incest', 'minor', 'teen', 'child', 'underage'
]

def is_safe(text):
    lower = text.lower()
    return not any(k in lower for k in FORBIDDEN_KEYWORDS)

def fetch_post_html(path):
    HOST = 'viralmms.com'
    IP = '104.21.35.79'
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5)
    s.connect((IP, 443))
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    in_b, out_b = ssl.MemoryBIO(), ssl.MemoryBIO()
    ssl_obj = ctx.wrap_bio(in_b, out_b, server_hostname=HOST)
    
    try: ssl_obj.do_handshake()
    except ssl.SSLWantReadError: pass
    
    ch = out_b.read()
    s.sendall(ch[:30]); time.sleep(0.01); s.sendall(ch[30:])
    
    while True:
        try: ssl_obj.do_handshake(); break
        except ssl.SSLWantReadError:
            c = s.recv(4096); in_b.write(c)
        except ssl.SSLWantWriteError:
            d = out_b.read(); s.sendall(d)
    d = out_b.read()
    if d: s.sendall(d)
    
    req = f'GET {path} HTTP/1.1\r\nHost: {HOST}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nConnection: close\r\n\r\n'.encode('utf-8')
    ssl_obj.write(req)
    s.sendall(out_b.read())
    
    s.settimeout(2.0)
    raw = b''
    for _ in range(16):
        try:
            c = s.recv(8192)
            if not c: break
            in_b.write(c)
            while True:
                try: raw += ssl_obj.read(8192)
                except: break
        except: break
    s.close()
    return raw.decode('utf-8', errors='ignore')

def parse_iso_duration(d):
    if not d or not d.startswith('PT'): return ""
    m = re.search(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', d)
    if not m: return ""
    h, mins, s = m.groups()
    h = int(h) if h else 0
    mins = int(mins) if mins else 0
    s = int(s) if s else 0
    if h > 0:
        return f"{h}:{mins:02d}:{s:02d}"
    return f"{mins}:{s:02d}"

def verify_stream(stream_url):
    try:
        req = urllib.request.Request(
            stream_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Range": "bytes=0-10"
            }
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            return resp.status in (200, 206)
    except:
        return False

def process_post(url):
    slug = url.split('/post/')[-1].strip('/')
    if not is_safe(slug):
        return None

    path = f"/post/{slug}"
    try:
        html = fetch_post_html(path)
        content_url_m = re.search(r'["\']contentUrl["\']\s*:\s*["\']([^"\']+)["\']', html)
        content_url = content_url_m.group(1) if content_url_m else ""
        if not content_url:
            mp4_m = re.search(r'https://vms\.viralmms\.net/[a-zA-Z0-9\-_/]+\.mp4', html)
            if mp4_m:
                content_url = mp4_m.group(0)

        if not content_url:
            return None

        title_m = re.search(r'["\']name["\']\s*:\s*["\']([^"\']+)["\']', html)
        title = title_m.group(1) if title_m else slug.replace('-', ' ').title()
        if not is_safe(title):
            return None

        thumb_m = re.search(r'["\']thumbnailUrl["\']\s*:\s*["\']([^"\']+)["\']', html)
        thumb = thumb_m.group(1) if thumb_m else ""

        dur_m = re.search(r'["\']duration["\']\s*:\s*["\']([^"\']+)["\']', html)
        duration_iso = dur_m.group(1) if dur_m else ""
        duration = parse_iso_duration(duration_iso)

        author_m = re.search(r'["\']author["\']\s*:\s*\{[^}]*["\']name["\']\s*:\s*["\']([^"\']+)["\']', html)
        channel_name = author_m.group(1) if author_m else "ViralMMS"

        # Pre-verify 206 reachability
        if not verify_stream(content_url):
            return None

        return {
            "ok": True,
            "id": f"vmms-{slug[-6:]}",
            "title": title,
            "slug": slug,
            "postUrl": url,
            "streamUrl": content_url,
            "poster": thumb,
            "thumb": thumb,
            "category": channel_name.lower().replace(' ', '_'),
            "duration": duration,
            "type": "mp4",
            "source": "viralmms",
            "verifiedAt": int(time.time() * 1000)
        }
    except Exception as e:
        return None

if __name__ == '__main__':
    with open('data/viralmms_sitemap_posts.txt', 'r', encoding='utf-8') as f:
        all_posts = [l.strip() for l in f if l.strip()]

    # Filter safe posts
    safe_posts = [p for p in all_posts if is_safe(p)]
    print(f"Total sitemap posts: {len(all_posts)}, safe candidate posts: {len(safe_posts)}", flush=True)

    # Load existing catalog to avoid duplicates
    existing = []
    try:
        with open('data/viralmms_catalog.json', 'r', encoding='utf-8') as f:
            existing = json.load(f)
    except:
        pass

    existing_slugs = {v.get('slug') for v in existing if v.get('slug')}
    candidate_posts = [p for p in safe_posts if p.split('/post/')[-1].strip('/') not in existing_slugs]

    TARGET_COUNT = 60
    needed = TARGET_COUNT - len(existing)
    print(f"Currently in catalog: {len(existing)}. Need {needed} more videos.", flush=True)

    if needed > 0:
        batch = candidate_posts[:needed + 20]
        print(f"Scraping batch of {len(batch)} posts with 6 parallel threads...", flush=True)
        new_items = []
        with ThreadPoolExecutor(max_workers=6) as executor:
            for item in executor.map(process_post, batch):
                if item:
                    new_items.append(item)
                    print(f" [+] Added: {item['title'][:55]}... ({len(existing) + len(new_items)} total)", flush=True)
                    if len(existing) + len(new_items) >= TARGET_COUNT:
                        break

        total_catalog = existing + new_items
        with open('data/viralmms_catalog.json', 'w', encoding='utf-8') as f:
            json.dump(total_catalog, f, indent=2)
        print(f"\nSaved updated catalog with {len(total_catalog)} videos to data/viralmms_catalog.json!", flush=True)
    else:
        print("Catalog already has desired count.", flush=True)
