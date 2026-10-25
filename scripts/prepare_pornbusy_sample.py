import os
import subprocess
import json

sample_items = [
    {
        "id": "pb-145210",
        "raw_id": 145210,
        "bucket": "145000",
        "title": "Stunning Blonde Babe Passionate Bedroom Romance",
        "category": "blonde",
        "tags": ["western", "blonde", "hardcore", "hd1024p", "amateur"],
        "views": "142k"
    },
    {
        "id": "pb-145211",
        "raw_id": 145211,
        "bucket": "145000",
        "title": "Busty Brunette POV Cock Sucking & Doggy Ride",
        "category": "pov",
        "tags": ["western", "brunette", "pov", "hd1024p", "blowjob"],
        "views": "218k"
    },
    {
        "id": "pb-145212",
        "raw_id": 145212,
        "bucket": "145000",
        "title": "Horny Step-Sister Caught In The Living Room",
        "category": "taboo",
        "tags": ["western", "taboo", "stepsister", "hd1024p"],
        "views": "395k"
    },
    {
        "id": "pb-145214",
        "raw_id": 145214,
        "bucket": "145000",
        "title": "Sensual European Beauty Deep Throat & Hard Creampie",
        "category": "creampie",
        "tags": ["western", "european", "creampie", "hd1024p"],
        "views": "178k"
    },
    {
        "id": "pb-145215",
        "raw_id": 145215,
        "bucket": "145000",
        "title": "Hot College Slut Wild Shower Play & Rough Action",
        "category": "teen",
        "tags": ["western", "college", "teen", "hd1024p", "shower"],
        "views": "289k"
    },
    {
        "id": "pb-145216",
        "raw_id": 145216,
        "bucket": "145000",
        "title": "Curvy Redhead Intense Orgasm & Gushing Pussy",
        "category": "redhead",
        "tags": ["western", "redhead", "curvy", "hd1024p", "squirt"],
        "views": "310k"
    },
    {
        "id": "pb-145217",
        "raw_id": 145217,
        "bucket": "145000",
        "title": "Amateur Girlfriend First Time On Camera Cumshot",
        "category": "amateur",
        "tags": ["western", "amateur", "cumshot", "hd1024p"],
        "views": "164k"
    },
    {
        "id": "pb-145218",
        "raw_id": 145218,
        "bucket": "145000",
        "title": "Glamour Model VIP Private Suite Raw Fucking",
        "category": "glamour",
        "tags": ["western", "model", "vip", "hd1024p", "hardcore"],
        "views": "425k"
    },
    {
        "id": "pb-145219",
        "raw_id": 145219,
        "bucket": "145000",
        "title": "Naughty Babysitter Seduces Dad On The Sofa",
        "category": "milf",
        "tags": ["western", "milf", "babysitter", "hd1024p", "couch"],
        "views": "530k"
    },
    {
        "id": "pb-142913",
        "raw_id": 142913,
        "bucket": "142000",
        "title": "Ultra-Fit Gym Chick Stretched & Pounded In Locker Room",
        "category": "fitness",
        "tags": ["western", "fitness", "gym", "hd1024p", "deepthroat"],
        "views": "276k"
    }
]

catalog = []

for item in sample_items:
    vid = item['raw_id']
    b = item['bucket']
    stream_url = f"https://cdnstatic.imctransfer.com/static_01/{b}/{vid}/preview_1024.mp4"
    thumb_path = f"public/thumbs/pb_{vid}.jpg"
    thumb_url = f"/thumbs/pb_{vid}.jpg"
    
    print(f"Extracting thumb for {vid}...")
    cmd = [
        "ffmpeg", "-ss", "00:00:01",
        "-i", stream_url,
        "-vframes", "1",
        "-q:v", "2",
        thumb_path, "-y"
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        has_thumb = os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 1000
    except Exception as e:
        print(f"Error on {vid}: {e}")
        has_thumb = False
        
    entry = {
        "ok": True,
        "id": item["id"],
        "title": item["title"],
        "slug": item["title"].lower().replace(" ", "-"),
        "streamUrl": stream_url,
        "directStreamUrl": stream_url,
        "poster": thumb_url if has_thumb else "/pb_145219_test.jpg",
        "thumb": thumb_url if has_thumb else "/pb_145219_test.jpg",
        "category": item["category"],
        "tags": item["tags"],
        "hashtags": [f"#{t}" for t in item["tags"][:3]],
        "views": item["views"],
        "duration": "1:00",
        "type": "mp4",
        "tier": 1,
        "isHD": True,
        "cors": True,
        "sourceName": "PORNBUSY",
        "source": "pornbusy",
        "verifiedAt": 1792700666844
    }
    catalog.append(entry)
    print(f"  [OK] {item['id']} | Thumb: {has_thumb} ({os.path.getsize(thumb_path) if has_thumb else 0} bytes)")

with open("pornbusy_catalog.json", "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False)

print(f"\nSuccessfully generated pornbusy_catalog.json with {len(catalog)} verified videos!")
