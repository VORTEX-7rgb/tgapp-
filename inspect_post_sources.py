import streamx_bridge, re
from bs4 import BeautifulSoup

streamx_bridge.init_session()
headers = {
    "User-Agent": streamx_bridge.session_ua,
    "Referer": "https://sxyprn.com/"
}
r = streamx_bridge.cffi_session.get("https://sxyprn.com/post/6ad171e0dcc10.html", headers=headers, cookies=streamx_bridge.session_cookies)

soup = BeautifulSoup(r.text, 'html.parser')

print("Post Title:", soup.title.string if soup.title else "")
print("Video tags:", len(soup.find_all('video')))
for v in soup.find_all('video'):
    print("Video attributes:", v.attrs)

print("\nIframes:", len(soup.find_all('iframe')))
for f in soup.find_all('iframe'):
    print("Iframe src:", f.get('src'))

print("\nLinks with embed or player:")
for a in soup.find_all('a'):
    href = a.get('href', '')
    if any(k in href for k in ['embed', 'player', 'video', 'watch', 'stream']):
        print("Link:", href, a.text[:40])

# Check all scripts
print("\nScript tags containing 'player' or 'setup' or 'vid':")
for s in soup.find_all('script'):
    txt = s.string or ""
    if any(k in txt for k in ['player', 'setup', 'sources', 'trafficdeposit', 'vid8', 'cdn8']):
        print("Script snippet:", txt[:200].replace('\n', ' '))
