import time, json, requests
from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup

print("="*80)
print("FAILURE DRILL: EXPIRED SESSION / CLOUDFLARE 403 DETECTION & SELF-HEALING RECOVERY")
print("="*80)

# 1. Simulate dead / expired cookies
corrupted_cookies = {
    "cf_clearance": "EXPIRED_BOGUS_COOKIE_1234567890",
    "PHPSESSID": "deadbeef12345678"
}
ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
test_url = "https://sxyprn.com/post/6ad18f41d0f97.html"

print("\n[Phase 1] Attempting fetch with corrupted / expired cookies...")
t0 = time.time()
try:
    r_bad = cffi_requests.get(test_url, headers={"User-Agent": ua, "Referer": "https://sxyprn.com/"}, cookies=corrupted_cookies, timeout=10)
    status = r_bad.status_code
    html = r_bad.text
    is_blocked = (status == 403 or "challenge-running" in html or "cf-mitigated" in html or "Just a moment" in html or "data-vnfo" not in html)
    print(f"Status: {status} | Length: {len(html)} | Block Detected: {is_blocked}")
    if is_blocked:
        print(">>> CONFIRMED: Cloudflare challenge / block triggered as expected.")
except Exception as e:
    print(f"Fetch failed with error: {e}")
    is_blocked = True

# 2. Self-Healing Drill
print("\n[Phase 2] Triggering Self-Healing Re-Warm Recovery...")
t_heal_start = time.time()

# Request FlareSolverr to solve the challenge and provide fresh clearance
heal_payload = {
    "cmd": "request.get",
    "url": "https://sxyprn.com/",
    "session": "sxyprn_session",
    "maxTimeout": 30000
}
heal_res = requests.post("http://127.0.0.1:8191/v1", json=heal_payload, timeout=35).json()
sol = heal_res.get("solution", {})
fresh_cookies = {c["name"]: c["value"] for c in sol.get("cookies", [])}
fresh_ua = sol.get("userAgent", ua)

t_heal = round(time.time() - t_heal_start, 3)
print(f"Fresh cookies obtained in {t_heal}s: {list(fresh_cookies.keys())}")

# 3. Retry the request with the healed cookies
print("\n[Phase 3] Retrying failed video post with healed session...")
t_retry_start = time.time()
r_healed = cffi_requests.get(test_url, headers={"User-Agent": fresh_ua, "Referer": "https://sxyprn.com/"}, cookies=fresh_cookies, timeout=10)
t_retry = round(time.time() - t_retry_start, 3)

soup = BeautifulSoup(r_healed.text, "html.parser")
has_vnfo = bool(soup.find(attrs={"data-vnfo": True}))

print(f"Status: {r_healed.status_code} | Length: {len(r_healed.text)} | Time: {t_retry}s | has_vnfo: {has_vnfo}")

if r_healed.status_code == 200 and has_vnfo:
    print("\n" + "="*80)
    print("DRILL RESULT: PASS - System detected Cloudflare block and self-healed seamlessly!")
    print("="*80)
else:
    print("\n" + "="*80)
    print("DRILL RESULT: FAIL - Recovery did not succeed")
    print("="*80)
