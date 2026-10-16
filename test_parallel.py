import time, requests
from concurrent.futures import ThreadPoolExecutor

url = "https://c11.trafficdeposit.com/widi/o280pzy2j1j91zb2h6czn08/PqjPtHdlaorK9PtViqokKA/1792185920/6882d3b2f0585/6ad1a6641ebfa.vid"
headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://sxyprn.com/"}
TOTAL = 2097152 # 2 MB

t0 = time.time()
r1 = requests.get(url, headers={**headers, "Range": f"bytes=0-{TOTAL-1}"}, timeout=20)
d1 = time.time() - t0
print(f"Single Connection: 2MB in {d1:.2f}s | Speed: {len(r1.content)/(d1*1024):.1f} KB/s")

t1 = time.time()
w = 3
chunk = TOTAL // w
def fetch(i):
    s = i * chunk
    e = ((i + 1) * chunk - 1) if i < w - 1 else (TOTAL - 1)
    return requests.get(url, headers={**headers, "Range": f"bytes={s}-{e}"}, timeout=20).content

with ThreadPoolExecutor(max_workers=w) as ex:
    parts = list(ex.map(fetch, range(w)))
d2 = time.time() - t1
total_par = sum(len(p) for p in parts)
print(f"3-Way Parallel Slicing: 2MB in {d2:.2f}s | Speed: {total_par/(d2*1024):.1f} KB/s")
print(f"Multiplier: {d1/d2:.2f}x faster!")
