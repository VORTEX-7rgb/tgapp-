import requests

r = requests.post("http://127.0.0.1:8191/v1", json={"cmd": "request.get", "url": "https://sxyprn.com/", "session": "sxyprn_session"}).json()
for c in r.get("solution", {}).get("cookies", []):
    if c["name"] == "cf_clearance":
        print("cf_clearance cookie attributes:", c)
