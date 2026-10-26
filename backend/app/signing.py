"""OTA payload signing (Ed25519). In aws mode the private key lives in AWS Signer / KMS."""
from __future__ import annotations

import base64
import hashlib

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .config import settings

_PRIV = settings.keys_dir / "ota_signing.key"
_PUB = settings.keys_dir / "ota_signing.pub"
KEY_ID = "f2f-ota-ed25519-1"


def _key() -> Ed25519PrivateKey:
    if _PRIV.exists():
        return serialization.load_pem_private_key(_PRIV.read_bytes(), password=None)
    k = Ed25519PrivateKey.generate()
    _PRIV.write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    _PRIV.chmod(0o600)
    raw = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    _PUB.write_text(base64.b64encode(raw).decode() + "\n")
    return k


def ensure_keys() -> None:
    _key()


def sign(data: bytes) -> dict:
    return {"sha256": hashlib.sha256(data).hexdigest(), "signature": base64.b64encode(_key().sign(data)).decode(), "key_id": KEY_ID}
