#!/usr/bin/env python3
import os, select, sys, termios, time
try:
    attrs = termios.tcgetattr(sys.stdin)
    attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO)
    termios.tcsetattr(sys.stdin, termios.TCSANOW, attrs)
except Exception:
    pass
n = 0
sys.stdout.write("KEY_CHILD_READY\n")
sys.stdout.flush()
t0 = time.time()
while time.time() - t0 < 90:
    sys.stdout.write("OUT %d\n" % int(time.time()*1000))
    sys.stdout.flush()
    r, _, _ = select.select([sys.stdin], [], [], 0.02)
    if r:
        data = os.read(sys.stdin.fileno(), 64)
        if b"a" in data or b"A" in data:
            n += 1
            sys.stdout.write("KEY_MARK %d\n" % n)
            sys.stdout.flush()
