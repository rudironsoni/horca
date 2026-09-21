GHOSTTY ?= /tmp/horca-d2-refs/ghostty-pin
FRAMEWORKS := -framework CoreFoundation -framework CoreGraphics \
  -framework CoreText -framework CoreVideo -framework QuartzCore \
  -framework IOSurface -framework Metal -framework MetalKit \
  -framework AppKit -framework Carbon
LDFLAGS := -L$(GHOSTTY)/zig-out/lib -lghostty -lc++ $(FRAMEWORKS)
CFLAGS := -I$(GHOSTTY)/include -Wall -Werror
BIN := build

all: $(BIN)/abi_header_probe $(BIN)/combined_passthru_headless

$(BIN):
	mkdir -p $(BIN)

$(BIN)/abi_header_probe: abi_header_probe.c | $(BIN)
	cc $(CFLAGS) -o $@ $< $(LDFLAGS)

$(BIN)/combined_passthru_headless: combined_passthru_headless.c | $(BIN)
	cc $(CFLAGS) -o $@ $< $(LDFLAGS)

.PHONY: all
