import socket, ssl, time, re, json, urllib.request, os, sys
sys.stdout.reconfigure(encoding='utf-8')
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch_skbj(path='/'):
    host = 'skbj.tv'
    try:
        ip = socket.gethostbyname(host)
    except Exception as e:
        return None, f"DNS error: {e}"
        
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(6.0)
    try:
        s.connect((ip, 443))
    except Exception as e:
        return None, f"Connect error: {e}"
        
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    in_b, out_b = ssl.MemoryBIO(), ssl.MemoryBIO()
    ssl_obj = ctx.wrap_bio(in_b, out_b, server_hostname=host)
    try: ssl_obj.do_handshake()
    except ssl.SSLWantReadError: pass
    ch = out_b.read()
    s.sendall(ch[:25]); time.sleep(0.015); s.sendall(ch[25:])
    
    while True:
        try: ssl_obj.do_handshake(); break
        except ssl.SSLWantReadError:
            c = s.recv(4096)
            if not c: break
            in_b.write(c)
        except ssl.SSLWantWriteError:
            d = out_b.read()
            if not d: break
            s.sendall(d)
    d = out_b.read()
    if d: s.sendall(d)
    
    req = f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36\r\nConnection: close\r\n\r\n'.encode('utf-8')
    ssl_obj.write(req)
    s.sendall(out_b.read())
    s.settimeout(3.0)
    raw = b''
    content_len = None
    header_end = -1
    
    while True:
        try:
            c = s.recv(16384)
            if not c: break
            in_b.write(c)
            while True:
                try: 
                    chunk = ssl_obj.read(16384)
                    if not chunk: break
                    raw += chunk
                except: break
                
            if header_end == -1 and b'\r\n\r\n' in raw:
                header_end = raw.find(b'\r\n\r\n')
                headers_str = raw[:header_end].decode('utf-8', errors='ignore')
                m = re.search(r'content-length:\s*(\d+)', headers_str, re.I)
                if m:
                    content_len = int(m.group(1))
            
            if content_len is not None and len(raw) - (header_end + 4) >= content_len:
                break
            if b'\r\n0\r\n\r\n' in raw or b'</urlset>' in raw or b'</sitemapindex>' in raw:
                break
        except:
            break
            
    s.close()
    return raw.decode('utf-8', errors='ignore'), None

def verify_stream(url, timeout=5):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': 'bytes=0-1000'
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as res:
            if res.status in (200, 206):
                crange = res.headers.get('Content-Range', '')
                clength = res.headers.get('Content-Length', '0')
                total_bytes = 0
                if crange and '/' in crange:
                    try: total_bytes = int(crange.split('/')[-1])
                    except: pass
                elif clength:
                    try: total_bytes = int(clength)
                    except: pass
                size_mb = round(total_bytes / (1024 * 1024), 1) if total_bytes > 0 else 0
                return True, size_mb
    except:
        pass
    return False, 0

def format_duration(seconds_str):
    try:
        sec = int(seconds_str)
        m = sec // 60
        s = sec % 60
        return f"{m}:{s:02d}"
    except:
        return "15:00"

def categorize(title, slug):
    text = f"{title} {slug}".lower()
    tags = ["korean_bj", "skbj"]
    hashtags = ["#KoreanBJ", "#SKBJ"]
    
    if any(k in text for k in ["dance", "dancing", "shake", "vip"]):
        cat = "dance"
        tags.extend(["dance", "vip"])
        hashtags.extend(["#CamDance", "#VIP"])
    elif any(k in text for k in ["bikini", "cosplay", "costume", "maid", "nurse", "school"]):
        cat = "cosplay"
        tags.extend(["cosplay", "bikini"])
        hashtags.extend(["#Cosplay", "#Bikini"])
    elif any(k in text for k in ["strip", "nude", "naked", "shower", "bath", "dildo"]):
        cat = "strip"
        tags.extend(["strip", "nude"])
        hashtags.extend(["#StripShow", "#Nude"])
    elif any(k in text for k in ["model", "top", "queen", "star"]):
        cat = "models"
        tags.extend(["model", "top_bj"])
        hashtags.extend(["#TopBJ", "#Model"])
    else:
        cat = "solo"
        tags.extend(["solo", "tease"])
        hashtags.extend(["#Solo", "#CamTease"])
        
    return cat, tags, hashtags

def main():
    target_count = 60
    print(f"--- Fetching latest sitemap /sitemaps/videos-1.xml ---")
    xml, err = fetch_skbj('/sitemaps/videos-1.xml')
    if not xml:
        print("Failed to fetch sitemap:", err)
        return

    # Extract all <url> blocks
    url_blocks = re.findall(r'<url>(.*?)</url>', xml, re.DOTALL)
    print(f"Found {len(url_blocks)} raw URL blocks in sitemap.")

    candidates = []
    for b in url_blocks:
        loc_m = re.search(r'<loc>([^<]+)</loc>', b)
        content_m = re.search(r'<video:content_loc>([^<]+)</video:content_loc>', b)
        thumb_m = re.search(r'<video:thumbnail_loc>([^<]+)</video:thumbnail_loc>', b)
        title_m = re.search(r'<video:title>([^<]+)</video:title>', b)
        dur_m = re.search(r'<video:duration>([^<]+)</video:duration>', b)

        if loc_m and content_m:
            post_url = loc_m.group(1).strip()
            stream_url = content_m.group(1).strip()
            thumb_url = thumb_m.group(1).strip() if thumb_m else ""
            raw_title = title_m.group(1).strip() if title_m else ""
            dur_sec = dur_m.group(1).strip() if dur_m else "900"
            
            slug = post_url.split('/videos/')[-1].strip()
            
            clean_title = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', raw_title)
            if not clean_title or clean_title == "None":
                clean_title = f"Korean BJ Cam Show ({slug})"
                
            candidates.append({
                'postUrl': post_url,
                'slug': slug,
                'streamUrl': stream_url,
                'thumb': thumb_url,
                'poster': thumb_url,
                'raw_title': clean_title,
                'duration_sec': dur_sec
            })

    print(f"Extracted {len(candidates)} candidate items with direct streams.")
    print(f"Beginning concurrent verification to find {target_count} ultra-fast working streams...\n")

    verified_videos = []
    checked = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=20) as executor:
        future_map = {executor.submit(verify_stream, c['streamUrl']): c for c in candidates}
        for future in as_completed(future_map):
            checked += 1
            cand = future_map[future]
            try:
                ok, size_mb = future.result()
                if ok:
                    idx = len(verified_videos) + 1
                    cat, tags, hashtags = categorize(cand['raw_title'], cand['slug'])
                    
                    video_obj = {
                        "ok": True,
                        "id": f"skbj-{cand['slug']}",
                        "title": cand['raw_title'],
                        "slug": cand['slug'],
                        "postUrl": cand['postUrl'],
                        "streamUrl": cand['streamUrl'],
                        "poster": cand['poster'],
                        "thumb": cand['thumb'],
                        "category": cat,
                        "duration": format_duration(cand['duration_sec']),
                        "type": "mp4",
                        "source": "skbj",
                        "sourceName": "SexKbj",
                        "tier": 1,
                        "sizeMb": size_mb,
                        "tags": tags,
                        "hashtags": hashtags,
                        "verifiedAt": int(time.time() * 1000)
                    }
                    verified_videos.append(video_obj)
                    safe_title = cand['raw_title'].encode('ascii', 'ignore').decode('ascii')
                    print(f"  [VERIFIED #{idx}] '{safe_title[:45]}' ({size_mb} MB) -> {cat}", flush=True)

                    if len(verified_videos) >= target_count:
                        for f in future_map:
                            f.cancel()
                        break
            except Exception as e:
                pass

    elapsed = round(time.time() - t0, 1)
    print(f"\nVerification complete in {elapsed}s! Checked {checked} candidates. Found {len(verified_videos)} working videos.")

    out_file = 'data/sexkbj_catalog.json'
    os.makedirs('data', exist_ok=True)
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(verified_videos, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(verified_videos)} verified items to {out_file} successfully.")

if __name__ == '__main__':
    main()
