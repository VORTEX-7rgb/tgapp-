import requests, re, json
from curl_cffi import requests as cffi_requests

r = requests.post("http://127.0.0.1:8191/v1", json={"cmd": "request.get", "url": "https://sxyprn.com/", "session": "sxyprn_session"}).json()
cookies = {c["name"]: c["value"] for c in r.get("solution", {}).get("cookies", [])}
ua = r.get("solution", {}).get("userAgent", "")

main2 = cffi_requests.get("https://sxyprn.com/js/main2.js?97", headers={"User-Agent": ua, "Referer": "https://sxyprn.com/"}, cookies=cookies).text

print("Main2 length:", len(main2))
idx = main2.find("function getvsrc()")
print("=== GETVSRC FUNCTION ===")
print(main2[idx:idx+1500])

