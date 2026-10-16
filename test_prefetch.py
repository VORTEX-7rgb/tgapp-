import sqlite3, os
import streamx_bridge

conn = sqlite3.connect('/root/streamx.db')
row = conn.execute("SELECT post_id, cdn_url FROM streams ORDER BY rowid DESC LIMIT 1").fetchone()
post_id, cdn_url = row[0], row[1]
print("Testing prefetch for:", post_id)
print("CDN URL:", cdn_url)

cache_file = os.path.join(streamx_bridge.RAM_CACHE_DIR, f"{post_id}_head.bin")
size_file = os.path.join(streamx_bridge.RAM_CACHE_DIR, f"{post_id}_size.txt")
print("cache_file exists?", os.path.exists(cache_file))
print("size_file exists?", os.path.exists(size_file))
if os.path.exists(size_file):
    print("size_file content:", open(size_file).read())

# Perform GET directly with headers
res = streamx_bridge.cdn_session.get(cdn_url, headers={
    "User-Agent": streamx_bridge.session_ua,
    "Referer": "https://sxyprn.com/",
    "Range": "bytes=0-524287"
}, timeout=12)
print("Direct GET status:", res.status_code)
print("Direct GET Content-Range:", res.headers.get("Content-Range"))
print("Direct GET Content-Length:", res.headers.get("Content-Length"))

