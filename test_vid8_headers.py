import requests, re, json
from curl_cffi import requests as cffi_requests
import streamx_bridge

streamx_bridge.init_session()

# 1. Fetch post page and decode vnfo
post_id = "6ad171e0dcc10"
post_url = f"https://sxyprn.com/post/{post_id}.html"


headers = {
    "User-Agent": streamx_bridge.session_ua,
    "Referer": "https://sxyprn.com/"
}
r = streamx_bridge.cffi_session.get(post_url, headers=headers, cookies=streamx_bridge.session_cookies, timeout=10)
from bs4 import BeautifulSoup
soup = BeautifulSoup(r.text, 'html.parser')
vnfo_el = soup.find(attrs={"data-vnfo": True})
vnfo = json.loads(vnfo_el.get("data-vnfo", "{}"))
raw_vid = vnfo.get(post_id)
decoded_path = streamx_bridge.decode_vnfo_src(raw_vid, host="sxyprn.com")
full_vid_url = "https://sxyprn.com" + decoded_path
print("Decoded vid8 URL:", full_vid_url)


# Test Case 1: Exact Referer https://sxyprn.com/post/...
print("\n--- Test 1: Referer https://sxyprn.com/post/... ---")
res1 = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua,
    "Referer": post_url
}, cookies=streamx_bridge.session_cookies, allow_redirects=False)
print("Status:", res1.status_code)
print("Location:", res1.headers.get("Location"))

# Test Case 2: No Referer at all
print("\n--- Test 2: NO Referer (referrerpolicy=no-referrer) ---")
res2 = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua
}, cookies=streamx_bridge.session_cookies, allow_redirects=False)
print("Status:", res2.status_code)
print("Location:", res2.headers.get("Location"))

# Test Case 3: External Referer (e.g. user app)
print("\n--- Test 3: External Referer (https://prompt-radius-hook-var.trycloudflare.com/) ---")
res3 = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua,
    "Referer": "https://prompt-radius-hook-var.trycloudflare.com/"
}, cookies=streamx_bridge.session_cookies, allow_redirects=False)
print("Status:", res3.status_code)
print("Location:", res3.headers.get("Location"))

# Test Case 4: No Cookies at all on /vid8/
print("\n--- Test 4: NO Cookies on /vid8/ ---")
res4 = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua,
    "Referer": post_url
}, allow_redirects=False)
print("Status:", res4.status_code)
print("Location:", res4.headers.get("Location"))

# Test Case 5: NO Cookies AND NO Referer
print("\n--- Test 5: NO Cookies AND NO Referer ---")
res5 = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua
}, allow_redirects=False)
print("Status:", res5.status_code)
print("Location:", res5.headers.get("Location"))
