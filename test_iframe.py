import streamx_bridge

streamx_bridge.init_session()
r = streamx_bridge.cffi_session.get('https://sxyprn.com/', cookies=streamx_bridge.session_cookies)
print('Status:', r.status_code)
print('X-Frame-Options:', r.headers.get('x-frame-options'))
print('CSP:', r.headers.get('content-security-policy'))
