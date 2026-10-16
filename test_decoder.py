import base64, re, json, requests

def ssut51(arg):
    s = re.sub(r'[^0-9]', '', arg)
    return sum(int(c) for c in s)

def boo(ss, es, host="sxyprn.com"):
    raw = f"{ss}-{host}-{es}".encode('utf-8')
    b = base64.b64encode(raw).decode('utf-8')
    return b.replace('+', '-').replace('/', '_').replace('=', '.')

def preda(arg):
    val = int(arg[5]) - (ssut51(arg[6]) + ssut51(arg[7]))
    arg[5] = str(val)
    return arg

def decode_vnfo_src(raw_src, host="sxyprn.com"):
    tmp = raw_src.split("/")
    token = boo(ssut51(tmp[6]), ssut51(tmp[7]), host)
    tmp[1] = tmp[1] + "8" + "/" + token
    tmp = preda(tmp)
    return "/".join(tmp)

raw_path = "/cdn/c7/8220pzl201u99zs2v6xzr0u/xr9Cq1BrtI7viFLjDeZh3g/1792181890/q659n8b251c44c7f02y8h8efq96/x46ra5ds1o8nfs4f1nd40wf39u7.vid"
decoded = decode_vnfo_src(raw_path)
print("Decoded .vid URL:", decoded)

r_sess = requests.post("http://127.0.0.1:8191/v1", json={"cmd": "request.get", "url": "https://sxyprn.com/", "session": "sxyprn_session"}).json()
cookies = {c["name"]: c["value"] for c in r_sess.get("solution", {}).get("cookies", [])}
ua = r_sess.get("solution", {}).get("userAgent", "")

headers = {
    "User-Agent": ua,
    "Referer": "https://sxyprn.com/post/6ad18f41d0f97.html"
}
full_url = "https://sxyprn.com" + decoded
print("Testing GET on:", full_url)
r = requests.get(full_url, headers=headers, cookies=cookies, allow_redirects=False, timeout=10)
print("Redirect Status:", r.status_code)
print("Location Header:", r.headers.get("Location"))
