"""
Discord Companion Bot — Pending Command Hook
Checks for pending Discord messages on every prompt.
If any exist, outputs them so Claude can respond.
"""
import urllib.request
import json
import ssl

PENDING_URL = "https://YOUR-WORKER.workers.dev/pending"
WEBHOOK_URL = "https://discord.com/api/webhooks/1475791794292785183/CNz4-37BTVabKLTAilXawGhrXnGhr5BB2ny4yqzr7YJiM4dJtnqiMfOr1g_5ec3X6sKq"

try:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(PENDING_URL)
    with urllib.request.urlopen(req, timeout=5, context=ctx) as response:
        data = json.loads(response.read().decode())

    if not data:
        exit(0)

    print("[DISCORD BOT] Pending commands detected:")
    for cmd in data:
        companion = cmd.get("companion_name", cmd.get("companion_id", "unknown"))
        author = cmd.get("author", {})
        username = author.get("username", "unknown") if isinstance(author, dict) else str(author)
        content = cmd.get("content", "")
        cmd_id = cmd.get("id", "")
        channel = cmd.get("channel_id", "")
        age = cmd.get("age_seconds", 0)
        print(f"  - Companion: {companion} | From: {username} | Message: \"{content}\" | ID: {cmd_id} | Channel: {channel} | Age: {age}s")

    print(f"\nRespond as the companion using webhook: {WEBHOOK_URL}")
    print("Use curl to POST: {\"content\": \"<response>\", \"username\": \"<companion name>\", \"avatar_url\": \"<companion avatar>\"}")

except Exception:
    pass
