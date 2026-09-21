#!/usr/bin/env python3
import fcntl, os, select, signal, struct, sys, termios, time

MODE = os.environ.get("HORCA_CHILD_MODE", "query")

def tty_size():
    buf = struct.pack("HHHH", 0, 0, 0, 0)
    rows, cols, _, _ = struct.unpack(
        "HHHH", fcntl.ioctl(sys.stdout.fileno(), termios.TIOCGWINSZ, buf)
    )
    return cols, rows

def on_int(signum, frame):
    sys.stdout.write("INT_SENTINEL\n")
    sys.stdout.flush()
    os._exit(0)

signal.signal(signal.SIGINT, on_int)
try:
    attrs = termios.tcgetattr(sys.stdin)
    attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO)
    termios.tcsetattr(sys.stdin, termios.TCSANOW, attrs)
except Exception:
    pass
sys.stdout.write("PTY_READY\n")
sys.stdout.flush()

if MODE == "query":
    sys.stdout.write("\x1b[c")
    sys.stdout.flush()
    deadline = time.time() + 8
    buf = b""
    while time.time() < deadline:
        r, _, _ = select.select([sys.stdin], [], [], 0.1)
        if r:
            buf += os.read(sys.stdin.fileno(), 4096)
            if b"\x1b[" in buf and b"c" in buf:
                sys.stdout.write("QUERY_GOT_REPLY\n")
                sys.stdout.flush()
                break
    for _ in range(30):
        cols, rows = tty_size()
        sys.stdout.write(f"TTY_SIZE {cols} {rows}\n")
        sys.stdout.flush()
        time.sleep(0.3)
elif MODE == "flood":
    import threading
    n = int(os.environ.get("HORCA_FLOOD_BYTES", str(8 * 1024 * 1024)))
    def writer():
        chunk = b"X" * 4096
        left = n
        while left > 0:
            w = chunk if left >= len(chunk) else chunk[:left]
            sys.stdout.buffer.write(w)
            left -= len(w)
        sys.stdout.buffer.write(b"\nFLOOD_SENTINEL\n")
        sys.stdout.buffer.flush()
    threading.Thread(target=writer, daemon=True).start()
    while True:
        r, _, _ = select.select([sys.stdin], [], [], 0.2)
        if r:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                break
            if b"a" in data or b"A" in data:
                sys.stdout.write("KEY_MARK\n")
                sys.stdout.flush()
elif MODE == "echo":
    while True:
        r, _, _ = select.select([sys.stdin], [], [], 0.2)
        if r:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                break
            sys.stdout.buffer.write(b"ECHO:" + data + b"\n")
            sys.stdout.buffer.flush()
