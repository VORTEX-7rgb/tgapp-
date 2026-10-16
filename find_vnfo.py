import requests, re, json
from curl_cffi import requests as cffi_requests

r = requests.post("http://127.0.0.1:8191/v1", json={"cmd": "request.get", "url": "https://sxyprn.com/", "session": "sxyprn_session"}).json()
cookies = {c["name"]: c["value"] for c in r.get("solution", {}).get("cookies", [])}
ua = r.get("solution", {}).get("userAgent", "")

main2 = cffi_requests.get("https://sxyprn.com/js/main2.js?97", headers={"User-Agent": ua, "Referer": "https://sxyprn.com/"}, cookies=cookies).text

idx = main2.find("vidsnfo")
print("=== MAIN2 SNIPPET AROUND vidsnfo ===")
print(main2[max(0, idx-100):min(len(main2), idx+1000)])

for func in ["function boo", "function ssut51", "function preda", "function rc"]:
    f_idx = main2.find(func)
    if f_idx != -1:
        print(f"=== {func} ===")
        print(main2[f_idx:f_idx+500])
    else:
        print(f"{func} NOT FOUND directly with 'function'")
        # search for name
        name = func.split()[1]
        matches = [m.start() for m in re.finditer(name, main2)]
        print(f"Occurrences of {name}: {len(matches)}")
        for m in matches[:3]:
            print(main2[max(0, m-50):min(len(main2), m+200)])
