#!/usr/bin/env python3
import os, select, sys, termios, time
try:
    attrs = termios.tcgetattr(sys.stdin)
    attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO | termios.ISIG)
    termios.tcsetattr(sys.stdin, termios.TCSANOW, attrs)
except Exception:
    pass
sys.stdout.write("HEX_READY\n")
sys.stdout.flush()
deadline = time.time() + 8
buf = b""
while time.time() < deadline:
    r, _, _ = select.select([sys.stdin], [], [], 0.05)
    if r:
        chunk = os.read(sys.stdin.fileno(), 4096)
        if not chunk:
            break
        buf += chunk
        if b"END" in buf:
            payload = buf.split(b"END")[0]
            sys.stdout.write("HEX " + payload.hex() + "\n")
            sys.stdout.flush()
            break
time.sleep(2)
