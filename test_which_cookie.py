import requests
import streamx_bridge

streamx_bridge.init_session()
vid_url = "https://sxyprn.com/cdn8/NTYtc3h5cHJuLmNvbS0yNQ../c7/nf250hzy2f1v9xz72x60zi0/HdvDXKlHKJxn2JF41ZPAcQ/1792193947/nk6d1y8raafkbz5be6ck3z91a98/do6xa5ds1t7v1xea02dfcucb120.vid"
cookies = streamx_bridge.session_cookies
print("All cookies:", list(cookies.keys()))

for name in cookies.keys():
    test_c = {name: cookies[name]}
    res = requests.get(vid_url, headers={"User-Agent": streamx_bridge.session_ua}, cookies=test_c, allow_redirects=False)
    print(f"Cookie '{name}' alone => Status: {res.status_code}")

# What if only cf_clearance?
# What if all cookies EXCEPT cf_clearance?
no_cf = {k: v for k, v in cookies.items() if k != "cf_clearance"}
res_no_cf = requests.get(vid_url, headers={"User-Agent": streamx_bridge.session_ua}, cookies=no_cf, allow_redirects=False)
print(f"All cookies EXCEPT cf_clearance => Status: {res_no_cf.status_code}")
