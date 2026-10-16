import sqlite3

conn = sqlite3.connect('/root/streamx.db')
cols = [r[1] for r in conn.execute("PRAGMA table_info(streams)").fetchall()]
print("Current columns in streams:", cols)

if "total_bytes" not in cols:
    print("Adding total_bytes column...")
    conn.execute("ALTER TABLE streams ADD COLUMN total_bytes INTEGER DEFAULT 0")
    conn.commit()
    print("Column added!")
else:
    print("total_bytes column already exists!")
