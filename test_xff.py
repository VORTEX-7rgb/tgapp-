import requests, re, json
import streamx_bridge

streamx_bridge.init_session()

# Let's get our local India public IP
local_ip_res = requests.get("https://api.ipify.org?format=json")
local_ip = local_ip_res.json().get("ip")
print("Local India IP:", local_ip)

vps_ip_res = requests.get("https://api.ipify.org?format=json", proxies={})
# In the script running on VPS, local_ip is passed as target client IP

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

# Case A: Normal request from VPS
resA = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua,
    "Referer": post_url
}, cookies=streamx_bridge.session_cookies, allow_redirects=False)
locA = resA.headers.get("Location")
print("\nLocation A (VPS default):", locA)

# Case B: Request with X-Forwarded-For: <fake_or_client_ip>
test_client_ip = "49.37.150.22" # Sample Indian Reliance Jio IP
resB = streamx_bridge.cdn_session.get(full_vid_url, headers={
    "User-Agent": streamx_bridge.session_ua,
    "Referer": post_url,
    "X-Forwarded-For": test_client_ip,
    "X-Real-IP": test_client_ip,
    "Client-IP": test_client_ip
}, cookies=streamx_bridge.session_cookies, allow_redirects=False)
locB = resB.headers.get("Location")
print("\nLocation B (with X-Forwarded-For):", locB)

print("\nDid the Location URL change when X-Forwarded-For was passed?")
print("Identical?", locA == locB)
if locA != locB:
    print("DIFFERENT! SxyPrn USED THE CLIENT IP FROM X-FORWARDED-FOR!")
else:
    print("Identical: SxyPrn used the TCP connection IP ($remote_addr).")
