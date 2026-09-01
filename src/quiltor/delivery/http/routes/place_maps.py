"""Upload and delivery for the images a place's maps are drawn on.

Images arrive base64-encoded inside a JSON body rather than as a multipart
upload. That is not squeamishness about encoding overhead: the handler's refusal
of every content type but `application/json` is what makes a cross-site form
post impossible, because a form can only send text/plain, urlencoded or
multipart. A multipart upload route would open exactly that door, and the third
that base64 adds is paid once per image instead of on every save.
"""

from __future__ import annotations

import base64
import binascii

from quiltor.application.place_maps import MapImageRejected
from quiltor.delivery.http.routes import Request, get, save


@save("/api/place-maps", world=True)
def upload_place_map(handler, request: Request, app) -> None:
    payload = handler._read_json_body()
    if not isinstance(payload, dict):
        return handler.send_api_error(400, error_code="place_map.invalid_request")
    encoded = payload.get("data")
    if not isinstance(encoded, str) or not encoded:
        return handler.send_api_error(400, error_code="place_map.invalid_request")
    try:
        # `validate=True` so stray characters are a refusal rather than bytes
        # nobody intended; what arrives here is decided by the sender.
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return handler.send_api_error(400, error_code="place_map.invalid_encoding")

    try:
        with app.lock:
            image = app.place_maps.store(content, request.db_path)
    except MapImageRejected as error:
        return handler.send_exception(error)

    handler.send_json(
        {
            "id": image.id,
            "mime": image.mime,
            "width": image.width,
            "height": image.height,
            "byteSize": image.byte_size,
        },
        201,
    )


@get("/api/place-map", world=True)
def read_place_map(handler, request: Request, app) -> None:
    image_id = request.param("id")
    if not image_id:
        return handler.send_api_error(400, error_code="place_map.invalid_request")
    with app.lock:
        content = app.place_maps.content(image_id, request.db_path)
    handler.send_image(content.mime, content.data, content.id)


__all__ = ["read_place_map", "upload_place_map"]
