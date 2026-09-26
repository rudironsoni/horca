#include <ghostty.h>
#include <stddef.h>

static void write_cb(void *ud, const uint8_t *ptr, uintptr_t len) {
  (void)ud;
  (void)ptr;
  (void)len;
}

static void resize_cb(void *ud, uint16_t cols, uint16_t rows, uint32_t w, uint32_t h) {
  (void)ud;
  (void)cols;
  (void)rows;
  (void)w;
  (void)h;
}

int main(void) {
  ghostty_io_backend_e backend = GHOSTTY_IO_BACKEND_PASSTHRU;
  ghostty_surface_config_s cfg = ghostty_surface_config_new();
  cfg.platform_tag = GHOSTTY_PLATFORM_HEADLESS;
  cfg.platform.headless.reserved = NULL;
  cfg.io_backend = backend;
  cfg.pty_write_cb = write_cb;
  cfg.pty_resize_cb = resize_cb;
  (void)ghostty_surface_headless_frame;
  (void)ghostty_surface_pty_data;
  (void)ghostty_surface_read_text;
  (void)ghostty_surface_read_selection;
  return backend == GHOSTTY_IO_BACKEND_PASSTHRU ? 0 : 1;
}
