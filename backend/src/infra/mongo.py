"""Motor (async MongoDB) client factory.

One AsyncIOMotorClient per process. Collections used by the app are listed in
infra/mongo/init.js — this module just opens connections and exposes helpers.
"""

from __future__ import annotations

import os
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


def get_client() -> Optional[AsyncIOMotorClient]:
    global _client
    if _client is not None:
        return _client
    uri = os.getenv("MONGO_URI")
    if not uri:
        return None
    _client = AsyncIOMotorClient(uri, uuidRepresentation="standard")
    return _client


def get_db(name: str = "vegaedge") -> Optional[AsyncIOMotorDatabase]:
    global _db
    client = get_client()
    if client is None:
        return None
    if _db is None or _db.name != name:
        _db = client[name]
    return _db


async def ping() -> bool:
    client = get_client()
    if client is None:
        return False
    try:
        await client.admin.command("ping")
        return True
    except Exception:
        return False


def close() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
        _client = None
        _db = None
