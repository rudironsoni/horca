#!/usr/bin/env python3
import os, signal, sys, termios, time
n = 0
def on_int(signum, frame):
    global n
    n += 1
    sys.stdout.write("INT_SENTINEL %d SIGINT\n" % n)
    sys.stdout.flush()
signal.signal(signal.SIGINT, on_int)
try:
    attrs = termios.tcgetattr(sys.stdin)
    attrs[3] = attrs[3] & ~(termios.ICANON | termios.ECHO)
    # keep ISIG so 0x03 generates SIGINT
    termios.tcsetattr(sys.stdin, termios.TCSANOW, attrs)
except Exception:
    pass
sys.stdout.write("CTRLC_CHILD_READY\n")
sys.stdout.flush()
t0 = time.time()
while time.time() - t0 < 90:
    sys.stdout.write("OUT %d\n" % int(time.time()*1000))
    sys.stdout.flush()
    time.sleep(0.02)
