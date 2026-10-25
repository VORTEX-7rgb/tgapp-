import socket, ssl, time, re, json, urllib.request, threading, os, struct
from concurrent.futures import ThreadPoolExecutor, as_completed

FORBIDDEN_KEYWORDS = [
    'sister', 'brother', 'family', 'taboo', 'bhai', 'behan', 'rape', 'forced',
    'sleep', 'sleeping', 'incest', 'minor', 'teen', 'child', 'underage', 'ped', 'zoo', 'beast'
]

CF_IPS = ['104.21.35.79', '172.67.215.226']

def is_safe(text):
    if not text: return True
    lower = text.lower()
    return not any(k in lower for k in FORBIDDEN_KEYWORDS)

def fetch_post_html(path):
    HOST = 'viralmms.com'
    for ip in CF_IPS:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect((ip, 443))
            
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
                    c = s.recv(4096)
                    if not c:
                        raise ConnectionResetError("TLS handshake disconnected by peer")
                    in_b.write(c)
                except ssl.SSLWantWriteError:
                    d = out_b.read()
                    if not d: break
                    s.sendall(d)
            d = out_b.read()
            if d: s.sendall(d)
            
            req = f'GET {path} HTTP/1.1\r\nHost: {HOST}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nConnection: close\r\n\r\n'.encode('utf-8')
            ssl_obj.write(req)
            s.sendall(out_b.read())
            
            s.settimeout(1.5)
            raw = b''
            for _ in range(12):
                try:
                    c = s.recv(8192)
                    if not c: break
                    in_b.write(c)
                    while True:
                        try:
                            chunk = ssl_obj.read(8192)
                            if not chunk: break
                            raw += chunk
                        except: break
                    if b'</html>' in raw or b'</HTML>' in raw:
                        break
                except: break
            s.close()
            html = raw.decode('utf-8', errors='ignore')
            if html.startswith('HTTP/1.1 200') or '<html' in html or '<HTML' in html:
                return html
        except Exception:
            continue
    return ""

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

def inspect_mp4_faststart(stream_url):
    """
    Probes stream URL header via 128KB HTTP Range request.
    Verifies:
      1. HTTP 206 Partial Content
      2. Single MOOV atom at head of file (FastStart)
      3. No duplicate MOOV atoms
      4. Dimensions & rotation from tkhd box
      5. File size <= 25MB
    """
    try:
        req = urllib.request.Request(
            stream_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Range": "bytes=0-131071"
            }
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        with urllib.request.urlopen(req, context=ctx, timeout=4.0) as resp:
            if resp.status not in (200, 206):
                return None
            cr = resp.headers.get('Content-Range', '')
            total_size = int(cr.split('/')[-1]) if '/' in cr else 0
            if total_size <= 0:
                total_size = int(resp.headers.get('Content-Length', 0))
            data = resp.read()
    except Exception:
        return None

    size_mb = round(total_size / (1024 * 1024), 2) if total_size > 0 else 0.0

    idx = 0
    moov_data = None
    moov_count = 0
    mdat_found = False

    while idx + 8 <= len(data):
        box_len, btype = struct.unpack('>I4s', data[idx:idx+8])
        name = btype.decode('latin1', errors='ignore')
        if box_len < 8:
            break
        if box_len == 1:
            if idx + 16 > len(data): break
            box_len = struct.unpack('>Q', data[idx+8:idx+16])[0]
            if box_len < 16: break

        if name == 'moov':
            moov_count += 1
            if moov_data is None:
                if mdat_found:
                    # Tail MOOV (mdat before moov) - NOT FastStart
                    return {
                        'faststart': False,
                        'size_mb': size_mb,
                        'is_vertical': False,
                        'width': 0, 'height': 0, 'ratio': 0.0
                    }
                if idx + box_len <= len(data):
                    moov_data = data[idx:idx+box_len]
                else:
                    # Fetch remaining moov chunk
                    try:
                        req_moov = urllib.request.Request(
                            stream_url,
                            headers={
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                                "Range": f"bytes={idx}-{idx+box_len+8}"
                            }
                        )
                        with urllib.request.urlopen(req_moov, context=ctx, timeout=4.0) as r2:
                            moov_data = r2.read()[:box_len]
                    except:
                        pass
        elif name == 'mdat':
            mdat_found = True

        idx += box_len
        if idx >= len(data) and moov_data:
            break

    if not moov_data or moov_count != 1:
        # Either missing moov or corrupt duplicate moov (like kmb-83544 defect)
        return {
            'faststart': False,
            'size_mb': size_mb,
            'is_vertical': False,
            'width': 0, 'height': 0, 'ratio': 0.0
        }

    # Extract dimensions & rotation from tkhd
    tkhd_pos = moov_data.find(b'tkhd')
    if tkhd_pos == -1:
        return {
            'faststart': True,
            'size_mb': size_mb,
            'is_vertical': False,
            'width': 0, 'height': 0, 'ratio': 0.0
        }

    tkhd_start = tkhd_pos - 4
    tkhd_size = struct.unpack('>I', moov_data[tkhd_start:tkhd_start+4])[0]
    tkhd = moov_data[tkhd_start:tkhd_start+tkhd_size]
    version = tkhd[8]

    mat_offset = 60 if version == 1 else 48
    mat = struct.unpack('>9i', tkhd[mat_offset:mat_offset+36])
    a, b, u, c, d, v, x, y, w = mat

    w_raw, h_raw = struct.unpack('>II', tkhd[tkhd_size-8:tkhd_size])
    width = w_raw >> 16
    height = h_raw >> 16

    rotation = 0
    if a == 0 and b > 0 and c < 0 and d == 0:
        rotation = 90
    elif a < 0 and b == 0 and c == 0 and d < 0:
        rotation = 180
    elif a == 0 and b < 0 and c > 0 and d == 0:
        rotation = 270

    eff_w = height if rotation in (90, 270) else width
    eff_h = width if rotation in (90, 270) else height

    if eff_w <= 0 or eff_h <= 0:
        return {
            'faststart': True,
            'size_mb': size_mb,
            'is_vertical': False,
            'width': 0, 'height': 0, 'ratio': 0.0
        }

    ratio = round(eff_h / eff_w, 2)
    is_vertical = ratio >= 1.25

    return {
        'faststart': True,
        'size_mb': size_mb,
        'is_vertical': is_vertical,
        'width': eff_w,
        'height': eff_h,
        'ratio': ratio,
        'rotation': rotation
    }

def process_candidate_url(url):
    slug = url.split('/post/')[-1].strip('/')
    if not is_safe(slug):
        return None

    path = f"/post/{slug}"
    html = fetch_post_html(path)
    if not html:
        return None

    # Step 1: Detect video stream
    content_url_m = re.search(r'["\']contentUrl["\']\s*:\s*["\']([^"\']+)["\']', html)
    content_url = content_url_m.group(1) if content_url_m else ""
    if not content_url:
        mp4_m = re.search(r'https://vms\.viralmms\.net/[a-zA-Z0-9\-_/]+\.mp4', html)
        if mp4_m:
            content_url = mp4_m.group(0)

    if not content_url:
        # Static photoshoot or image gallery - drop immediately
        return {'status': 'photo_gallery', 'slug': slug}

    title_m = re.search(r'["\']name["\']\s*:\s*["\']([^"\']+)["\']', html)
    title = title_m.group(1) if title_m else slug.replace('-', ' ').title()
    if not is_safe(title):
        return None

    thumb_m = re.search(r'["\']thumbnailUrl["\']\s*:\s*["\']([^"\']+)["\']', html)
    if not thumb_m:
        thumb_m = re.search(r'<meta property=["\']og:image["\'] content=["\']([^"\']+)["\']', html)
    thumb = thumb_m.group(1) if thumb_m else ""

    dur_m = re.search(r'["\']duration["\']\s*:\s*["\']([^"\']+)["\']', html)
    duration_iso = dur_m.group(1) if dur_m else ""
    duration = parse_iso_duration(duration_iso)

    cat_m = re.search(r'/category/([a-zA-Z0-9\-_]+)', html)
    category = cat_m.group(1) if cat_m else "indian_mms_porn"

    # Step 2: Probe MP4 header for FastStart & Orientation
    probe = inspect_mp4_faststart(content_url)
    if not probe:
        return None

    video_id = f"vmms-{slug[-6:]}"
    now_ts = int(time.time() * 1000)

    catalog_entry = {
        "ok": True,
        "id": video_id,
        "title": title,
        "slug": slug,
        "postUrl": url,
        "streamUrl": content_url,
        "poster": thumb,
        "thumb": thumb,
        "category": category,
        "duration": duration,
        "type": "mp4",
        "source": "viralmms",
        "verifiedAt": now_ts
    }

    is_pure_vertical = probe['faststart'] and probe['is_vertical'] and (probe['size_mb'] <= 25.0)

    pure_vertical_entry = None
    fast_reel_entry = None

    if is_pure_vertical:
        pure_vertical_entry = {
            "ok": True,
            "id": video_id,
            "title": title,
            "slug": slug,
            "postUrl": url,
            "streamUrl": content_url,
            "poster": thumb,
            "thumb": thumb,
            "category": category,
            "duration": duration,
            "type": "mp4",
            "source": "viralmms",
            "verifiedAt": now_ts,
            "sizeMb": probe['size_mb'],
            "width": probe['width'],
            "height": probe['height'],
            "ratio": str(probe['ratio']),
            "isVertical": True
        }
        fast_reel_entry = {
            "ok": True,
            "id": video_id,
            "title": title,
            "slug": slug,
            "postUrl": url,
            "streamUrl": content_url,
            "poster": thumb,
            "thumb": thumb,
            "category": category,
            "duration": duration,
            "type": "mp4",
            "source": "viralmms",
            "verifiedAt": now_ts,
            "sizeMb": probe['size_mb']
        }

    return {
        'status': 'video_found',
        'catalog_entry': catalog_entry,
        'pure_vertical_entry': pure_vertical_entry,
        'fast_reel_entry': fast_reel_entry,
        'is_pure_vertical': is_pure_vertical,
        'size_mb': probe['size_mb']
    }

def main(max_limit=None):
    sitemap_file = 'cache/viralmms_sitemap_all.txt'
    pv_file = 'data/viralmms_pure_vertical.json'
    fr_file = 'data/viralmms_fast_reels.json'
    cat_file = 'data/viralmms_catalog.json'

    # Load existing catalogs
    pv_list = []
    fr_list = []
    cat_list = []

    if os.path.exists(pv_file):
        with open(pv_file, 'r', encoding='utf-8') as f:
            pv_list = json.load(f)
    if os.path.exists(fr_file):
        with open(fr_file, 'r', encoding='utf-8') as f:
            fr_list = json.load(f)
    if os.path.exists(cat_file):
        with open(cat_file, 'r', encoding='utf-8') as f:
            cat_list = json.load(f)

    existing_slugs = set()
    existing_urls = set()
    existing_ids = set()

    for v in cat_list:
        if v.get('slug'): existing_slugs.add(v['slug'].lower())
        if v.get('postUrl'): existing_urls.add(v['postUrl'].lower())
        if v.get('id'): existing_ids.add(v['id'])
    for v in pv_list:
        if v.get('slug'): existing_slugs.add(v['slug'].lower())
        if v.get('postUrl'): existing_urls.add(v['postUrl'].lower())
        if v.get('id'): existing_ids.add(v['id'])

    with open(sitemap_file, 'r', encoding='utf-8') as f:
        all_lines = [l.strip() for l in f if l.strip()]

    processed_slugs_file = 'cache/viralmms_processed_slugs.txt'
    processed_slugs = set()
    if os.path.exists(processed_slugs_file):
        with open(processed_slugs_file, 'r', encoding='utf-8') as f:
            processed_slugs = set(line.strip().lower() for line in f if line.strip())

    candidates = []
    for u in all_lines:
        if '/post/' not in u:
            continue
        slug = u.split('/post/')[-1].strip().lower()
        if slug in existing_slugs or u.lower() in existing_urls or slug in processed_slugs:
            continue
        if not is_safe(slug):
            continue
        candidates.append(u)

    print(f"Loaded existing: {len(pv_list)} pure vertical, {len(fr_list)} fast reels, {len(cat_list)} general catalog.")
    print(f"Already processed slugs: {len(processed_slugs)}")
    print(f"Total unscraped clean candidates remaining: {len(candidates)}")

    if max_limit:
        candidates = candidates[:max_limit]
        print(f"Limiting execution to {max_limit} test items.")

    lock = threading.Lock()
    new_pv = 0
    new_cat = 0
    photos_dropped = 0
    processed = 0
    t0 = time.time()
    new_slugs_to_save = []

    def checkpoint():
        with lock:
            # Atomic writes using temp files
            for path, data in [(pv_file, pv_list), (fr_file, fr_list), (cat_file, cat_list)]:
                tmp = f"{path}.tmp"
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
                os.replace(tmp, path)
            if new_slugs_to_save:
                with open(processed_slugs_file, 'a', encoding='utf-8') as f:
                    for s in new_slugs_to_save:
                        f.write(s + '\n')
                new_slugs_to_save.clear()

    workers = 32 if not max_limit else 8
    print(f"Starting {workers} parallel harvesting workers...\n", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {executor.submit(process_candidate_url, u): u for u in candidates}
        for future in as_completed(future_map):
            processed += 1
            u = future_map[future]
            slug_done = u.split('/post/')[-1].strip().lower()
            with lock:
                new_slugs_to_save.append(slug_done)

            try:
                res = future.result()
                if not res:
                    continue

                if res.get('status') == 'photo_gallery':
                    with lock:
                        photos_dropped += 1

                elif res.get('status') == 'video_found':
                    with lock:
                        c_entry = res['catalog_entry']
                        if c_entry['id'] not in existing_ids:
                            existing_ids.add(c_entry['id'])
                            cat_list.append(c_entry)
                            new_cat += 1

                        if res['is_pure_vertical']:
                            pv_entry = res['pure_vertical_entry']
                            fr_entry = res['fast_reel_entry']
                            pv_list.append(pv_entry)
                            fr_list.append(fr_entry)
                            new_pv += 1
                            print(f"  [REEL +] Found 9:16 Vertical: '{pv_entry['title'][:40]}' ({pv_entry['width']}x{pv_entry['height']}, ratio {pv_entry['ratio']}, {pv_entry['sizeMb']}MB)", flush=True)

                if (new_pv + new_cat) % 10 == 0 or processed % 20 == 0:
                    checkpoint()
                    elapsed = time.time() - t0
                    rate = processed / elapsed if elapsed > 0 else 0
                    print(f"[Progress] Checked: {processed}/{len(candidates)} | +{new_pv} Pure Vertical Reels | +{new_cat} General Videos | Dropped {photos_dropped} photos | {rate:.1f} req/s", flush=True)

            except Exception as e:
                pass

    checkpoint()
    elapsed = round(time.time() - t0, 1)
    print("\n" + "="*70)
    print(f"HARVESTING COMPLETE in {elapsed}s")
    print(f"  - Total Candidates Processed: {processed}")
    print(f"  - Static Photos Dropped: {photos_dropped}")
    print(f"  - New General Videos Added to Catalog: +{new_cat} (Total: {len(cat_list)})")
    print(f"  - NEW 9:16 PURE VERTICAL REELS ADDED: +{new_pv} (Total: {len(pv_list)})")
    print("="*70 + "\n", flush=True)

if __name__ == '__main__':
    import sys
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    main(limit)
