import sys, os, time, re, json, base64, urllib.parse, threading, sqlite3
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from curl_cffi import requests as cffi_requests
import requests as std_requests
from requests.adapters import HTTPAdapter
from bs4 import BeautifulSoup

PORT = 5050
FLARESOLVERR_URL = "http://127.0.0.1:8191/v1"
SESSION_ID = "sxyprn_session"
PUBLIC_DIR = "/root/streamx_public"
RAM_CACHE_DIR = "/dev/shm/streamx_cache"
DB_PATH = "/root/streamx.db"
HEAD_CACHE_BYTES = 524288  # 512 KB fast start chunk

os.makedirs(RAM_CACHE_DIR, exist_ok=True)
os.makedirs(PUBLIC_DIR, exist_ok=True)

# High-speed connection-pooled session for CDN streaming
cdn_session = std_requests.Session()
adapter = HTTPAdapter(pool_connections=150, pool_maxsize=150, max_retries=2)
cdn_session.mount("https://", adapter)
cdn_session.mount("http://", adapter)

# Persistent curl_cffi session for fast SxyPrn resolution
cffi_session = cffi_requests.Session()

# In-memory feed cache & session cookies
feed_cache = {}
session_cookies = {}
session_ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
session_lock = threading.Lock()

# ==========================================
# 1. SQLITE MASTER DATABASE
# ==========================================
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS streams (
            post_id TEXT PRIMARY KEY,
            cdn_url TEXT NOT NULL,
            title TEXT,
            poster TEXT,
            duration TEXT,
            views TEXT,
            related_json TEXT,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            total_bytes INTEGER DEFAULT 0
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_expires ON streams (expires_at)")
    conn.commit()
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(streams)").fetchall()]
        if "total_bytes" not in cols:
            conn.execute("ALTER TABLE streams ADD COLUMN total_bytes INTEGER DEFAULT 0")
            conn.commit()
    except Exception:
        pass
    conn.close()

def get_cached_stream(post_id):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""
            SELECT post_id, cdn_url, title, poster, duration, views, related_json, total_bytes, expires_at
            FROM streams WHERE post_id = ? AND expires_at > ?
        """, (post_id, int(time.time()) + 180)) # 3 min safety margin
        row = c.fetchone()
        conn.close()
        if row:
            related = []
            if row[6]:
                try: related = json.loads(row[6])
                except: pass
            total_b = row[7] or 0
            if total_b == 0:
                sf_path = os.path.join(RAM_CACHE_DIR, f"{row[0]}_size.txt")
                if os.path.exists(sf_path):
                    try:
                        with open(sf_path, "r") as sf:
                            t = sf.read().strip()
                            if t.isdigit(): total_b = int(t)
                    except: pass
            return {
                "ok": True,
                "id": row[0],
                "title": row[2] or f"Video {post_id}",
                "rawCdnUrl": row[1],
                "streamUrl": f"/api/play?id={row[0]}&url={urllib.parse.quote(row[1])}",
                "poster": f"/api/thumb?url={urllib.parse.quote(row[3])}" if row[3] else "",
                "duration": row[4] or "",
                "views": row[5] or "",
                "related": related,
                "total_bytes": total_b,
                "format": "mp4",
                "cached": True
            }
    except Exception as e:
        print(f"[DB Error] get_cached_stream: {e}")
    return None

def save_cached_stream(post_id, cdn_url, title, poster, duration, views, related, total_bytes=0, ttl_seconds=2700):
    try:
        now = int(time.time())
        expires_at = now + ttl_seconds
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO streams
            (post_id, cdn_url, title, poster, duration, views, related_json, total_bytes, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (post_id, cdn_url, title, poster, duration, views, json.dumps(related), total_bytes, expires_at, now))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB Error] save_cached_stream: {e}")

# ==========================================
# 2. FLARESOLVERR SESSION & RE-WARM
# ==========================================
def refresh_flaresolverr_session():
    global session_cookies, session_ua
    with session_lock:
        try:
            print("[StreamX Warden] Refreshing FlareSolverr session cookies...")
            r = std_requests.post(
                FLARESOLVERR_URL,
                json={"cmd": "request.get", "url": "https://sxyprn.com/", "session": SESSION_ID, "maxTimeout": 30000},
                timeout=35
            ).json()
            sol = r.get("solution", {})
            cookies = {}
            for c in sol.get("cookies", []):
                cookies[c["name"]] = c["value"]
            if cookies:
                session_cookies = cookies
                if sol.get("userAgent"):
                    session_ua = sol.get("userAgent")
                print(f"[StreamX Warden] Active cookies updated: {list(session_cookies.keys())}")
                return True
        except Exception as e:
            print(f"[StreamX Warden] Cookie refresh error: {e}")
        return False

def init_session():
    try:
        r = std_requests.post(FLARESOLVERR_URL, json={"cmd": "sessions.list"}, timeout=5).json()
        active = r.get("sessions", [])
        if SESSION_ID not in active:
            std_requests.post(FLARESOLVERR_URL, json={"cmd": "sessions.create", "session": SESSION_ID}, timeout=10)
    except Exception:
        pass
    refresh_flaresolverr_session()

# ==========================================
# 3. PURE MATHEMATICAL CIPHER DECODER
# ==========================================
def ssut51(arg):
    s = re.sub(r'[^0-9]', '', str(arg))
    return sum(int(c) for c in s)

def boo(ss, es, host="sxyprn.com"):
    raw = f"{ss}-{host}-{es}".encode('utf-8')
    b = base64.b64encode(raw).decode('utf-8')
    return b.replace('+', '-').replace('/', '_').replace('=', '.')

def preda(arg):
    val = int(arg[5]) - (ssut51(arg[6]) + ssut51(arg[7]))
    arg[5] = str(val)
    return arg

def decode_vnfo_src(raw_src, host="sxyprn.com"):
    tmp = raw_src.split("/")
    token = boo(ssut51(tmp[6]), ssut51(tmp[7]), host)
    tmp[1] = tmp[1] + "8" + "/" + token
    tmp = preda(tmp)
    return "/".join(tmp)

# ==========================================
# 4. BACKGROUND PRE-WARMING
# ==========================================
def prefetch_head_chunk(post_id, cdn_url):
    cache_file = os.path.join(RAM_CACHE_DIR, f"{post_id}_head.bin")
    size_file = os.path.join(RAM_CACHE_DIR, f"{post_id}_size.txt")
    if os.path.exists(cache_file) and os.path.exists(size_file) and os.path.getsize(cache_file) >= HEAD_CACHE_BYTES:
        try:
            with open(size_file, "r") as sf:
                t = sf.read().strip()
                if t.isdigit():
                    conn = sqlite3.connect(DB_PATH)
                    conn.execute("UPDATE streams SET total_bytes = ? WHERE post_id = ? AND (total_bytes = 0 OR total_bytes IS NULL)", (int(t), post_id))
                    conn.commit()
                    conn.close()
        except Exception: pass
        return
    try:
        req_headers = {
            "User-Agent": session_ua,
            "Referer": "https://sxyprn.com/",
            "Range": f"bytes=0-{HEAD_CACHE_BYTES - 1}"
        }
        res = cdn_session.get(cdn_url, headers=req_headers, timeout=12)
        if res.status_code in [200, 206] and len(res.content) > 0:
            with open(cache_file, "wb") as f:
                f.write(res.content)
            cr = res.headers.get("Content-Range", "")
            if "/" in cr:
                total_len = cr.split("/")[1].strip()
                if total_len.isdigit():
                    with open(size_file, "w") as sf:
                        sf.write(total_len)
                    try:
                        conn = sqlite3.connect(DB_PATH)
                        conn.execute("UPDATE streams SET total_bytes = ? WHERE post_id = ?", (int(total_len), post_id))
                        conn.commit()
                        conn.close()
                    except Exception: pass
                    print(f"[StreamX FastStart] Cached 512KB MOOV burst + size ({total_len} bytes) for {post_id}")
    except Exception as e:
        print(f"[StreamX FastStart] Warning caching {post_id}: {e}")

def background_prewarm(video_ids):
    def worker():
        for vid in video_ids:
            try:
                cached = get_cached_stream(vid)
                if not cached:
                    resolve_video_stream(vid)
                    time.sleep(0.5)
            except Exception:
                pass
    threading.Thread(target=worker, daemon=True).start()

# ==========================================
# 5. CATALOG FEED PARSING
# ==========================================
def fetch_feed(cat="trending", page=1):
    cache_key = f"{cat}_{page}"
    now = time.time()
    if cache_key in feed_cache and (now - feed_cache[cache_key][0]) < 300:
        return feed_cache[cache_key][1]

    if cat.lower() in ["trending", "home", "all"]:
        target_url = "https://sxyprn.com/" if page == 1 else f"https://sxyprn.com/?page={page}"
    else:
        target_url = f"https://sxyprn.com/{cat.capitalize()}.html?sm=trending" if page == 1 else f"https://sxyprn.com/{cat.capitalize()}.html?sm=trending&page={page}"

    headers = {
        "User-Agent": session_ua,
        "Referer": "https://sxyprn.com/"
    }

    if not session_cookies:
        refresh_flaresolverr_session()

    html = ""
    try:
        r = cffi_session.get(target_url, headers=headers, cookies=session_cookies, timeout=10)
        if r.status_code == 200 and len(r.text) > 10000 and "challenge-running" not in r.text:
            html = r.text
        else:
            refresh_flaresolverr_session()
            r2 = cffi_session.get(target_url, headers=headers, cookies=session_cookies, timeout=10)
            html = r2.text
    except Exception:
        refresh_flaresolverr_session()
        r = cffi_session.get(target_url, headers=headers, cookies=session_cookies, timeout=10)
        html = r.text

    soup = BeautifulSoup(html, 'html.parser')
    posts = soup.select('.post_el_small')
    videos = []
    for p in posts:
        wl = p.select_one('[data-postid]')
        post_id = wl.get('data-postid') if wl else None
        if not post_id:
            continue

        img = p.find('img')
        poster = ""
        if img:
            poster = img.get('data-src') or img.get('src') or ""
            if poster.startswith('//'):
                poster = 'https:' + poster

        post_text_div = p.select_one('.post_text')
        title = ""
        tags = []
        if post_text_div:
            for t in post_text_div.find_all('a', class_='hash_link'):
                lbl = t.get('label') or t.get_text(strip=True).replace('#', '')
                if lbl:
                    tags.append(lbl)
            title = post_text_div.get_text(strip=True, separator=" ")
            title = re.sub(r'#[a-zA-Z0-9_]+', '', title)
            title = re.sub(r'\b(lulustream\.com|doodstream\.co|vidara\.so|playmate\.to)\b', '', title, flags=re.I)
            title = re.sub(r'\s+', ' ', title).strip()

        text_content = p.get_text(separator=" | ")
        dur_match = re.search(r'\b(\d{1,2}:\d{2}(?::\d{2})?)\b', text_content)
        duration = dur_match.group(1) if dur_match else ""

        view_match = re.search(r'([\d.]+[kKmM]?)\s+views', text_content)
        views = view_match.group(1) if view_match else ""

        videos.append({
            "id": post_id,
            "url": f"https://sxyprn.com/post/{post_id}.html",
            "title": title[:90] if title else f"Video {post_id}",
            "rawPoster": poster,
            "poster": f"/api/thumb?url={urllib.parse.quote(poster)}" if poster else "",
            "duration": duration,
            "views": views,
            "tags": tags[:5]
        })

    result = {
        "ok": True,
        "cat": cat,
        "page": int(page),
        "count": len(videos),
        "videos": videos
    }
    feed_cache[cache_key] = (now, result)

    # Pre-warm top 5 videos in background
    if videos:
        background_prewarm([v["id"] for v in videos[:5]])

    return result

# ==========================================
# 6. STREAM RESOLVER (WARM HTTP/2 PURE-MATH)
# ==========================================
def resolve_video_stream(post_url_or_id):
    post_id = post_url_or_id
    if "/post/" in post_url_or_id:
        m = re.search(r'/post/([a-zA-Z0-9]+)', post_url_or_id)
        if m: post_id = m.group(1)
    post_id = post_id.replace('.html', '').strip()

    # 1. Check SQLite master table first (0.4ms hit)
    cached = get_cached_stream(post_id)
    if cached:
        return cached

    # 2. Fetch post HTML via warm cffi session (<0.2s)
    post_url = f"https://sxyprn.com/post/{post_id}.html"
    headers = {
        "User-Agent": session_ua,
        "Referer": "https://sxyprn.com/"
    }

    if not session_cookies:
        refresh_flaresolverr_session()

    try:
        r = cffi_session.get(post_url, headers=headers, cookies=session_cookies, timeout=10)
        if r.status_code == 403 or "challenge-running" in r.text or "data-vnfo" not in r.text:
            refresh_flaresolverr_session()
            r = cffi_session.get(post_url, headers=headers, cookies=session_cookies, timeout=10)
    except Exception:
        refresh_flaresolverr_session()
        r = cffi_session.get(post_url, headers=headers, cookies=session_cookies, timeout=10)

    soup = BeautifulSoup(r.text, 'html.parser')
    vnfo_el = soup.find(attrs={"data-vnfo": True})
    if not vnfo_el:
        raise Exception(f"No video source found for post {post_id}")

    try:
        vnfo_data = json.loads(vnfo_el.get("data-vnfo", "{}"))
    except Exception:
        raise Exception("Failed to parse data-vnfo payload")

    raw_vid = vnfo_data.get(post_id)
    if not raw_vid:
        if vnfo_data:
            raw_vid = list(vnfo_data.values())[0]
        else:
            raise Exception("Video key not in data-vnfo payload")

    # 3. Pure mathematical decoding (<0.0001s)
    decoded_path = decode_vnfo_src(raw_vid, host="sxyprn.com")
    full_vid_url = "https://sxyprn.com" + decoded_path

    # 4. Follow 302 redirect on VPS (<0.12s via connection pool)
    redir_res = cdn_session.get(
        full_vid_url,
        headers={"User-Agent": session_ua, "Referer": post_url},
        cookies=session_cookies,
        allow_redirects=False,
        timeout=12
    )

    location = redir_res.headers.get("Location")
    if not location or redir_res.status_code != 302:
        raise Exception(f"Upstream redirect failed with status {redir_res.status_code}")

    cdn_url = ("https:" + location) if location.startswith("//") else location

    # Extract metadata
    title = soup.title.string.strip() if soup.title else f"Video {post_id}"
    title = re.sub(r'\s*-\s*\[\d{1,2}:\d{2}\].*$', '', title)
    title = re.sub(r'#[a-zA-Z0-9_]+', '', title)
    title = re.sub(r'\s+', ' ', title).strip()

    player = soup.find('video', id='player_el')
    poster = ""
    if player and player.get('poster'):
        poster = player.get('poster')
        if poster.startswith('//'):
            poster = 'https:' + poster

    # Extract related videos
    related = []
    for rel in soup.select('.post_el_small')[:12]:
        wl = rel.select_one('[data-postid]')
        r_id = wl.get('data-postid') if wl else None
        if not r_id or r_id == post_id:
            continue
        r_img = rel.find('img')
        r_poster = (r_img.get('data-src') or r_img.get('src') or "") if r_img else ""
        if r_poster.startswith('//'): r_poster = 'https:' + r_poster
        r_text_div = rel.select_one('.post_text')
        r_title = r_text_div.get_text(strip=True, separator=" ") if r_text_div else f"Video {r_id}"
        r_title = re.sub(r'#[a-zA-Z0-9_]+', '', r_title).strip()
        dur_m = re.search(r'\b(\d{1,2}:\d{2}(?::\d{2})?)\b', rel.get_text())
        r_dur = dur_m.group(1) if dur_m else ""
        related.append({
            "id": r_id,
            "title": r_title[:80],
            "poster": f"/api/thumb?url={urllib.parse.quote(r_poster)}" if r_poster else "",
            "duration": r_dur
        })

    # Save to SQLite (45 minutes TTL)
    save_cached_stream(post_id, cdn_url, title, poster, "", "", related, total_bytes=0, ttl_seconds=2700)

    # Async prefetch 512KB burst to RAM disk + extract exact total size
    threading.Thread(target=prefetch_head_chunk, args=(post_id, cdn_url), daemon=True).start()

    return {
        "ok": True,
        "id": post_id,
        "title": title,
        "rawCdnUrl": cdn_url,
        "streamUrl": f"/api/play?id={post_id}&url={urllib.parse.quote(cdn_url)}",
        "poster": f"/api/thumb?url={urllib.parse.quote(poster)}" if poster else "",
        "duration": "",
        "views": "",
        "related": related,
        "format": "mp4",
        "cached": False
    }

# ==========================================
# 7. HIGH-PERFORMANCE STREAMING HANDLER
# ==========================================
class StreamXHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type, Accept")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_HEAD(self):
        self.handle_request(is_head=True)

    def do_GET(self):
        self.handle_request(is_head=False)

    def serve_static(self, file_path, content_type, is_head=False):
        if not os.path.exists(file_path):
            self.send_response(404)
            self.end_headers()
            return
        with open(file_path, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_cors_headers()
        self.end_headers()
        if not is_head:
            self.wfile.write(content)

    def handle_request(self, is_head=False):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        # Static assets
        if parsed.path in ["/", "/index.html"]:
            self.serve_static(os.path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8", is_head)
            return
        elif parsed.path == "/style.css":
            self.serve_static(os.path.join(PUBLIC_DIR, "style.css"), "text/css; charset=utf-8", is_head)
            return
        elif parsed.path == "/app.js":
            self.serve_static(os.path.join(PUBLIC_DIR, "app.js"), "application/javascript; charset=utf-8", is_head)
            return

        elif parsed.path == "/api/health":
            body = json.dumps({
                "ok": True,
                "engine": "StreamX Ultra Pure-Math v2 (Optimized Cold Call)",
                "uptime": int(time.time()),
                "ram_cache_files": len(os.listdir(RAM_CACHE_DIR))
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_cors_headers()
            self.end_headers()
            if not is_head:
                self.wfile.write(body)
            return

        elif parsed.path == "/api/feed":
            cat = qs.get("cat", ["trending"])[0]
            page = qs.get("page", ["1"])[0]
            try:
                data = fetch_feed(cat, int(page))
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "public, max-age=60")
                self.send_cors_headers()
                self.end_headers()
                if not is_head:
                    self.wfile.write(body)
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}).encode()
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_cors_headers()
                self.end_headers()
                if not is_head:
                    self.wfile.write(body)
            return

        elif parsed.path == "/api/stream":
            target = qs.get("url", [None])[0] or qs.get("id", [None])[0]
            if not target:
                body = json.dumps({"ok": False, "error": "Missing url or id parameter"}).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_cors_headers()
                self.end_headers()
                if not is_head:
                    self.wfile.write(body)
                return
            try:
                t0 = time.time()
                data = resolve_video_stream(target)
                data["resolve_time_ms"] = round((time.time() - t0) * 1000, 1)
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_cors_headers()
                self.end_headers()
                if not is_head:
                    self.wfile.write(body)
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}).encode()
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_cors_headers()
                self.end_headers()
                if not is_head:
                    self.wfile.write(body)
            return

        elif parsed.path == "/api/play":
            cdn_url = qs.get("url", [None])[0]
            post_id = qs.get("id", [""])[0]
            retry = qs.get("retry", ["0"])[0] == "1"

            if not cdn_url:
                self.send_response(400)
                self.end_headers()
                return

            client_range = self.headers.get("Range")
            cache_file = os.path.join(RAM_CACHE_DIR, f"{post_id}_head.bin") if post_id else ""
            size_file = os.path.join(RAM_CACHE_DIR, f"{post_id}_size.txt") if post_id else ""

            # Check if this is the initial chunk and we have both the head AND the total file size!
            if not retry and client_range and post_id and os.path.exists(cache_file):
                m_range = re.match(r'bytes=(\d+)-(\d*)', client_range)
                if m_range:
                    start_b = int(m_range.group(1))
                    end_b_str = m_range.group(2)
                    head_size = os.path.getsize(cache_file)
                    
                    total_size = ""
                    if os.path.exists(size_file):
                        try:
                            with open(size_file, "r") as sf:
                                total_size = sf.read().strip()
                        except:
                            total_size = ""

                    if not total_size or not total_size.isdigit():
                        try:
                            s = get_cached_stream(post_id)
                            if s and s.get("total_bytes"):
                                total_size = str(s["total_bytes"])
                        except Exception:
                            pass

                    # Only serve from RAM if we have a valid numeric total size
                    if start_b == 0 and head_size >= HEAD_CACHE_BYTES and total_size.isdigit():
                        end_b = int(end_b_str) if end_b_str else (head_size - 1)
                        if end_b >= head_size:
                            end_b = head_size - 1
                        
                        slice_len = (end_b - start_b) + 1
                        with open(cache_file, "rb") as f:
                            f.seek(start_b)
                            data = f.read(slice_len)

                        self.send_response(206)
                        self.send_header("Content-Type", "video/mp4")
                        self.send_header("Accept-Ranges", "bytes")
                        self.send_header("Content-Range", f"bytes {start_b}-{end_b}/{total_size}")
                        self.send_header("Content-Length", str(len(data)))
                        self.send_header("Cache-Control", "public, max-age=86400, immutable")
                        self.send_header("X-StreamX-Cache", "HIT-RAM-BURST")
                        self.send_cors_headers()
                        self.end_headers()
                        if not is_head:
                            self.wfile.write(data)
                            self.wfile.flush()
                        return

            # Direct stream pipeline with immediate packet flushing
            req_headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://sxyprn.com/"
            }
            if client_range:
                req_headers["Range"] = client_range

            try:
                upstream = cdn_session.get(cdn_url, headers=req_headers, stream=True, timeout=12)
                # Auto-heal on origin contention (503) or expired link (403, 404)
                if upstream.status_code in [403, 404, 503]:
                    time.sleep(0.15)
                    if post_id and upstream.status_code in [403, 404]:
                        try:
                            fresh = resolve_video_stream(post_id)
                            if fresh and fresh.get("rawCdnUrl"):
                                cdn_url = fresh["rawCdnUrl"]
                        except Exception: pass
                    upstream = cdn_session.get(cdn_url, headers=req_headers, stream=True, timeout=12)

                self.send_response(upstream.status_code)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "video/mp4"))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "public, max-age=86400, s-maxage=86400, immutable")
                self.send_header("X-StreamX-Cache", "DIRECT-RELAY")
                self.send_cors_headers()
                
                # Forward exact upstream Content-Range with real total length
                cr = upstream.headers.get("Content-Range")
                if cr:
                    self.send_header("Content-Range", cr)
                    if post_id and "/" in cr:
                        tlen = cr.split("/")[1].strip()
                        if tlen.isdigit():
                            if not os.path.exists(size_file):
                                try:
                                    with open(size_file, "w") as sf:
                                        sf.write(tlen)
                                except: pass
                            try:
                                conn = sqlite3.connect(DB_PATH)
                                conn.execute("UPDATE streams SET total_bytes = ? WHERE post_id = ?", (int(tlen), post_id))
                                conn.commit()
                                conn.close()
                            except Exception: pass

                if "Content-Length" in upstream.headers:
                    self.send_header("Content-Length", upstream.headers["Content-Length"])
                self.end_headers()

                if not is_head:
                    for chunk in upstream.iter_content(chunk_size=65536):
                        if chunk:
                            self.wfile.write(chunk)
                            self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                pass
            return

        elif parsed.path == "/api/thumb":
            thumb_url = qs.get("url", [None])[0]
            if not thumb_url:
                self.send_response(400)
                self.end_headers()
                return

            try:
                upstream = cdn_session.get(thumb_url, headers={"User-Agent": "Mozilla/5.0"}, stream=True, timeout=10)
                self.send_response(upstream.status_code)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "image/webp"))
                self.send_header("Cache-Control", "public, max-age=604800, s-maxage=604800, immutable")
                self.send_cors_headers()
                if "Content-Length" in upstream.headers:
                    self.send_header("Content-Length", upstream.headers["Content-Length"])
                self.end_headers()
                if not is_head:
                    for chunk in upstream.iter_content(chunk_size=131072):
                        if chunk:
                            self.wfile.write(chunk)
                            self.wfile.flush()
            except Exception:
                self.send_response(404)
                self.end_headers()
            return

        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    init_db()
    init_session()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), StreamXHandler)
    print(f"[StreamX Engine] Ultra-Optimized Streaming Engine Running on 0.0.0.0:{PORT}...")
    server.serve_forever()
