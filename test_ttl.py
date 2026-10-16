import json, re, time, requests, base64
from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup

def ssut51(arg):
    s = re.sub(r'[^0-9]', '', str(arg))
    return sum(int(c) for c in s)

def boo(ss, es, host='sxyprn.com'):
    raw = f'{ss}-{host}-{es}'.encode('utf-8')
    b = base64.b64encode(raw).decode('utf-8')
    return b.replace('+', '-').replace('/', '_').replace('=', '.')

def preda(arg):
    val = int(arg[5]) - (ssut51(arg[6]) + ssut51(arg[7]))
    arg[5] = str(val)
    return arg

def decode_vnfo_src(raw_src, host='sxyprn.com'):
    tmp = raw_src.split('/')
    token = boo(ssut51(tmp[6]), ssut51(tmp[7]), host)
    tmp[1] = tmp[1] + '8' + '/' + token
    tmp = preda(tmp)
    return '/'.join(tmp)

r_sess = requests.post('http://127.0.0.1:8191/v1', json={'cmd': 'request.get', 'url': 'https://sxyprn.com/', 'session': 'sxyprn_session'}).json()
cookies = {c['name']: c['value'] for c in r_sess.get('solution', {}).get('cookies', [])}
ua = r_sess.get('solution', {}).get('userAgent', '')

# Fetch 1 post
r = cffi_requests.get('https://sxyprn.com/post/6ad18f41d0f97.html', headers={'User-Agent': ua, 'Referer': 'https://sxyprn.com/'}, cookies=cookies)
soup = BeautifulSoup(r.text, 'html.parser')
vnfo = json.loads(soup.find(attrs={'data-vnfo': True})['data-vnfo'])
raw = vnfo['6ad18f41d0f97']
decoded = decode_vnfo_src(raw)
print('Decoded .vid URL:', decoded)

# Follow redirect to CDN
r_redir = requests.get('https://sxyprn.com' + decoded, headers={'User-Agent': ua, 'Referer': 'https://sxyprn.com/post/6ad18f41d0f97.html'}, cookies=cookies, allow_redirects=False)
cdn_url = r_redir.headers.get('Location')
print('CDN Location:', cdn_url)

now = int(time.time())
print(f'Current time (epoch): {now} ({time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(now))})')

# Extract timestamps from decoded path and CDN URL
m_decoded = re.findall(r'/(\d{10})/', decoded)
m_cdn = re.findall(r'/(\d{10})/', cdn_url)

print('\n--- TIMESTAMP ANALYSIS ---')
for ts in m_decoded:
    exp = int(ts)
    diff = exp - now
    print(f'Decoded URL Expiry Epoch: {exp} ({time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(exp))})')
    print(f'-> Valid for: {diff} seconds ({diff/60:.1f} minutes / {diff/3600:.2f} hours)')

for ts in m_cdn:
    exp = int(ts)
    diff = exp - now
    print(f'Final CDN Expiry Epoch: {exp} ({time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(exp))})')
    print(f'-> Valid for: {diff} seconds ({diff/60:.1f} minutes / {diff/3600:.2f} hours)')

# Also test an older URL from the previous session (generated ~1 hour ago)
# Earlier in our conversation we had:
# https://c7.trafficdeposit.com/widi/bl2q0wz9211q9yz82h6tz30/NiiuWpHj7-FqH7PKaWTYVA/1792179409/698214cf288f9/6ad18f41d0f97.vid
old_url = "https://c7.trafficdeposit.com/widi/bl2q0wz9211q9yz82h6tz30/NiiuWpHj7-FqH7PKaWTYVA/1792179409/698214cf288f9/6ad18f41d0f97.vid"
print('\n--- TESTING REPLAY OF PREVIOUSLY GENERATED URL ---')
r_old = requests.get(old_url, headers={'User-Agent': ua, 'Referer': 'https://sxyprn.com/', 'Range': 'bytes=0-100'}, timeout=10)
print(f'Old URL HTTP Status: {r_old.status_code} (Length: {len(r_old.content)})')
if r_old.status_code == 206:
    print('SUCCESS: Older URL is STILL ALIVE and fully streamable!')
