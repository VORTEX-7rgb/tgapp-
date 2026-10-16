import time, json, re, base64, requests
from bs4 import BeautifulSoup
from curl_cffi import requests as cffi_requests

# ==========================================
# 1. DECODER IMPLEMENTATION
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
# 2. SESSION SETUP
# ==========================================
print("[Step 0] Fetching warm FlareSolverr clearance cookies...")
r_sess = requests.post("http://127.0.0.1:8191/v1", json={"cmd": "request.get", "url": "https://sxyprn.com/", "session": "sxyprn_session"}).json()
cookies = {c["name"]: c["value"] for c in r_sess.get("solution", {}).get("cookies", [])}
ua = r_sess.get("solution", {}).get("userAgent", "")
print(f"Obtained {len(cookies)} cookies. UA: {ua[:40]}...")

# ==========================================
# 3. HARVEST 20 COLD POST IDs
# ==========================================
# Pull from different sections: page 2, page 3, Japanese, Russian, Anal, Milf
sources = [
    "https://sxyprn.com/?page=2",
    "https://sxyprn.com/?page=3",
    "https://sxyprn.com/Japanese.html",
    "https://sxyprn.com/Anal.html",
    "https://sxyprn.com/Milf.html"
]

cold_post_ids = []
print("[Step 1] Harvesting cold post IDs across multiple categories & pages...")
for s_url in sources:
    if len(cold_post_ids) >= 20:
        break
    try:
        r = cffi_requests.get(s_url, headers={"User-Agent": ua, "Referer": "https://sxyprn.com/"}, cookies=cookies, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        for wl in soup.select('[data-postid]'):
            pid = wl.get('data-postid')
            if pid and pid not in cold_post_ids:
                cold_post_ids.append(pid)
                if len(cold_post_ids) >= 20:
                    break
    except Exception as e:
        print(f"Error harvesting from {s_url}: {e}")

print(f"Harvested {len(cold_post_ids)} cold post IDs: {cold_post_ids}")

# ==========================================
# 4. RUN N=20 VALIDATION GATE
# ==========================================
results = []
print("\n" + "="*80)
print(f"RUNNING N={len(cold_post_ids)} COLD RESOLUTION & HTTP 206 VERIFICATION")
print("="*80)

for idx, pid in enumerate(cold_post_ids, 1):
    post_url = f"https://sxyprn.com/post/{pid}.html"
    t_start = time.time()
    
    # 1. Fetch HTML
    try:
        r_page = cffi_requests.get(post_url, headers={"User-Agent": ua, "Referer": "https://sxyprn.com/"}, cookies=cookies, timeout=10)
        ttf_html = round(time.time() - t_start, 3)
    except Exception as e:
        results.append({"id": pid, "status": "FAIL_FETCH", "error": str(e)})
        print(f"[{idx}/20] {pid} FAIL FETCH: {e}")
        continue

    # 2. Extract data-vnfo
    soup = BeautifulSoup(r_page.text, "html.parser")
    vidsnfo_el = soup.find(attrs={"data-vnfo": True})
    
    if not vidsnfo_el:
        results.append({"id": pid, "status": "NO_VNFO", "ttf": ttf_html})
        print(f"[{idx}/20] {pid} (TTF {ttf_html}s) - NO data-vnfo in page (external host or embedded)")
        continue

    try:
        vnfo_data = json.loads(vidsnfo_el.get("data-vnfo", "{}"))
    except Exception as e:
        results.append({"id": pid, "status": "BAD_JSON", "ttf": ttf_html})
        continue

    raw_vid = vnfo_data.get(pid)
    if not raw_vid:
        results.append({"id": pid, "status": "PID_NOT_IN_VNFO", "ttf": ttf_html})
        continue

    # 3. Decode with mathematical formula
    decoded_path = decode_vnfo_src(raw_vid, host="sxyprn.com")
    full_vid_url = "https://sxyprn.com" + decoded_path

    # 4. Follow 302 Redirect
    t_redir_start = time.time()
    try:
        r_redir = requests.get(
            full_vid_url,
            headers={"User-Agent": ua, "Referer": post_url},
            cookies=cookies,
            allow_redirects=False,
            timeout=10
        )
        t_redir = round(time.time() - t_redir_start, 3)
        location = r_redir.headers.get("Location")
        redir_status = r_redir.status_code
    except Exception as e:
        results.append({"id": pid, "status": "FAIL_REDIR", "error": str(e)})
        continue

    if redir_status != 302 or not location:
        results.append({"id": pid, "status": f"HTTP_{redir_status}", "location": location})
        print(f"[{idx}/20] {pid} (TTF {ttf_html}s) - Redir failed with status {redir_status}")
        continue

    final_cdn_url = ("https:" + location) if location.startswith("//") else location

    # 5. Verify HTTP 206 on Final CDN with byte range 0-1024
    t_byte_start = time.time()
    try:
        r_range = requests.get(
            final_cdn_url,
            headers={"User-Agent": ua, "Referer": post_url, "Range": "bytes=0-1024"},
            timeout=10
        )
        t_byte = round(time.time() - t_byte_start, 3)
        range_status = r_range.status_code
        bytes_recvd = len(r_range.content)
    except Exception as e:
        results.append({"id": pid, "status": "FAIL_RANGE", "error": str(e)})
        continue

    total_time = round(time.time() - t_start, 3)
    is_success = (range_status == 206 and bytes_recvd == 1025)

    res_item = {
        "idx": idx,
        "id": pid,
        "ttf_html": ttf_html,
        "t_redir": t_redir,
        "t_byte": t_byte,
        "total_time": total_time,
        "redir_code": redir_status,
        "range_code": range_status,
        "bytes": bytes_recvd,
        "cdn_host": location.split("/")[2] if "/" in location else "unknown",
        "success": is_success
    }
    results.append(res_item)
    print(f"[{idx:02d}/20] ID: {pid} | Total: {total_time:.3f}s (HTML: {ttf_html}s, 302: {t_redir}s, 206: {t_byte}s) | 206 Bytes: {bytes_recvd} | CDN: {res_item['cdn_host']} | {'PASS' if is_success else 'FAIL'}")

# ==========================================
# 5. SUMMARY
# ==========================================
passed = [r for r in results if r.get("success")]
print("\n" + "="*80)
print(f"VALIDATION GATE COMPLETE: {len(passed)}/{len(cold_post_ids)} SUCCEEDED")
print(f"Average Total Resolution + 206 Time: {sum(r['total_time'] for r in passed)/len(passed):.3f}s")
print("="*80)

with open("/root/validation_results.json", "w") as f:
    json.dump(results, f, indent=2)
