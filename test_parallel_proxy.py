import struct, requests

url = "https://c7.trafficdeposit.com/widi/vx2j0cz22e1g9yz92b6bz80/e53IWV0NrQ-ZSV--W6btmw/1792191049/698214cf288f9/6ad18f41d0f97.vid"
headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://sxyprn.com/"}

r = requests.get(url, headers={**headers, "Range": "bytes=0-131071"}, timeout=10)
data = r.content

idx = 0
while idx < len(data) - 8:
    box_len, box_type = struct.unpack('>I4s', data[idx:idx+8])
    box_name = box_type.decode('ascii', errors='ignore')
    print(f"Atom Box: {box_name} | Length: {box_len} bytes | Offset: {idx}")
    if box_len <= 0:
        break
    idx += box_len
    if idx >= len(data):
        break
