import socket, ssl, time, re, json, urllib.request

POSTS = [
    '/post/desi-aunty-topless-saree-see-through-nipples-746b',
    '/post/insta-model-ridz-topless-strip-tease-nude-desi-boobs-0zpw',
    '/post/shital-shaw-insta-model-saree-tease-2ubb',
    '/post/cute-girl-blowjob-pussy-fucking-3fs1-m29w',
    '/post/zhea-bhattacharya-nude-livecam-fingering-leaked-k7q9',
    '/post/indian-cam-girl-goes-completely-nude-on-stripchat-and-rubs-h-z03m',
    '/post/noida-punjabi-girl-blowjob-friend-c094',
    '/post/horny-girlfriend-rides-boyfriend',
    '/post/beautiful-girl-fucking-moaning-dard-hora-259l',
    '/post/hot-desi-model-rakhigill-gets-fully-nude-sucking-dick-and-l-xh27'
]

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

catalog = []
print(f"Scraping {len(POSTS)} posts from viralmms.com...", flush=True)

for i, p in enumerate(POSTS):
    slug = p.replace('/post/', '')
    print(f"[{i+1}/{len(POSTS)}] Scraping {slug}...", flush=True)
    try:
        html = fetch_post_html(p)
        # Search for Schema.org VideoObject
        v_match = re.search(r'\{[^{}]*"@type"\s*:\s*"VideoObject"[^{}]*\}', html)
        if not v_match:
            # Try wider match
            v_match = re.search(r'(\{"@context"[^\n]*"VideoObject"[^\n]*\})', html)
        
        video_obj = None
        if v_match:
            try:
                # Find balanced JSON
                raw_json = v_match.group(0)
                # Find inner VideoObject if nested
                video_obj = json.loads(raw_json)
            except:
                pass

        # Also extract directly with regex if json parse failed
        content_url_m = re.search(r'["\']contentUrl["\']\s*:\s*["\']([^"\']+)["\']', html)
        content_url = content_url_m.group(1) if content_url_m else ""
        
        title_m = re.search(r'["\']name["\']\s*:\s*["\']([^"\']+)["\']', html)
        title = title_m.group(1) if title_m else slug.replace('-', ' ').title()

        thumb_m = re.search(r'["\']thumbnailUrl["\']\s*:\s*["\']([^"\']+)["\']', html)
        thumb = thumb_m.group(1) if thumb_m else ""

        dur_m = re.search(r'["\']duration["\']\s*:\s*["\']([^"\']+)["\']', html)
        duration_iso = dur_m.group(1) if dur_m else ""
        duration = parse_iso_duration(duration_iso)

        author_m = re.search(r'["\']author["\']\s*:\s*\{[^}]*["\']name["\']\s*:\s*["\']([^"\']+)["\']', html)
        channel_name = author_m.group(1) if author_m else "ViralMMS"

        if not content_url:
            mp4_m = re.search(r'https://vms\.viralmms\.net/[a-zA-Z0-9\-_]+\.mp4', html)
            if mp4_m:
                content_url = mp4_m.group(0)

        if content_url:
            print(f"   Found MP4: {content_url}", flush=True)
            # Verify stream reachability
            is_valid = verify_stream(content_url)
            print(f"   Stream 206 Reachability: {'PASS' if is_valid else 'FAIL'}", flush=True)

            if is_valid:
                item = {
                    "ok": True,
                    "id": f"vmms-{slug[-6:]}",
                    "title": title,
                    "slug": slug,
                    "postUrl": f"https://viralmms.com{p}",
                    "streamUrl": content_url,
                    "poster": thumb,
                    "thumb": thumb,
                    "category": channel_name.lower().replace(' ', '_'),
                    "duration": duration,
                    "type": "mp4",
                    "source": "viralmms",
                    "verifiedAt": int(time.time() * 1000)
                }
                catalog.append(item)
    except Exception as e:
        print(f"   Error scraping {slug}: {e}", flush=True)

print(f"\nSuccessfully verified and built catalog with {len(catalog)} videos!", flush=True)
with open('data/viralmms_catalog.json', 'w', encoding='utf-8') as f:
    json.dump(catalog, f, indent=2)
print("Saved to data/viralmms_catalog.json", flush=True)
