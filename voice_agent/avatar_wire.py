"""Bounded binary JPEG transport between the GPU and the LiveKit worker (v1)."""
import struct
from dataclasses import dataclass

RATE = 16000
FPS = 25
SAMPLES = 15360
FRAMES = 24
WIDTH = HEIGHT = 512
MAX_PACKET = 8 * 1024 * 1024
HEADER = struct.Struct('!4sIQIH')
SIZE = struct.Struct('!I')


@dataclass(frozen=True)
class Pictures:
    epoch: int
    offset: int
    valid: int
    frames: list[bytes]


def pack(pictures: Pictures) -> bytes:
    payload = HEADER.pack(b'FHA1', pictures.epoch, pictures.offset,
                          pictures.valid, len(pictures.frames))
    payload += b''.join(SIZE.pack(len(frame)) + frame for frame in pictures.frames)
    unpack(payload)  # apply the same bounds on both ends
    return payload


def unpack(data: bytes) -> Pictures:
    if not HEADER.size <= len(data) <= MAX_PACKET:
        raise ValueError('Invalid avatar packet size')
    magic, epoch, offset, valid, count = HEADER.unpack_from(data)
    if magic != b'FHA1' or count != FRAMES or not 0 < valid <= SAMPLES:
        raise ValueError('Invalid avatar packet header')
    position = HEADER.size
    frames = []
    for _ in range(count):
        if position + SIZE.size > len(data):
            raise ValueError('Truncated avatar packet')
        size = SIZE.unpack_from(data, position)[0]
        position += SIZE.size
        if not 4 <= size <= 512 * 1024 or position + size > len(data):
            raise ValueError('Invalid avatar frame size')
        frame = data[position:position + size]
        if not frame.startswith(b'\xff\xd8') or not frame.endswith(b'\xff\xd9'):
            raise ValueError('Expected JPEG frame')
        frames.append(frame)
        position += size
    if position != len(data):
        raise ValueError('Trailing avatar packet bytes')
    return Pictures(epoch, offset, valid, frames)
