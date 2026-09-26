/**
 * Standalone checkpoint: headless Ghostty + passthru IO + Metal/IOSurface.
 * Adapted from mxschmitt/ghostty-xterm-bench native/renderer-poc/headless_a.c
 * (MIT) with passthru callbacks from madeye/ghostty@ea0622bc (MIT).
 */
#include <CoreFoundation/CoreFoundation.h>
#include <IOSurface/IOSurface.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <ghostty.h>

#define MARKER "HORCA_PTY_MARKER"
#define WIDTH_PX 800
#define HEIGHT_PX 400
#define SCALE 2.0

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static uint8_t g_writes[65536];
static size_t g_write_len = 0;
static uint16_t g_cols = 0, g_rows = 0;
static uint32_t g_cb_w = 0, g_cb_h = 0;
static int g_resize_n = 0;
static bool g_wakeup = false;

static void capture_write(void *ud, const uint8_t *ptr, uintptr_t len) {
  (void)ud;
  pthread_mutex_lock(&g_mu);
  if (g_write_len + len < sizeof(g_writes)) {
    memcpy(g_writes + g_write_len, ptr, len);
    g_write_len += len;
  }
  pthread_mutex_unlock(&g_mu);
}

static void capture_resize(void *ud, uint16_t cols, uint16_t rows, uint32_t w,
                           uint32_t h) {
  (void)ud;
  pthread_mutex_lock(&g_mu);
  g_cols = cols;
  g_rows = rows;
  g_cb_w = w;
  g_cb_h = h;
  g_resize_n++;
  pthread_mutex_unlock(&g_mu);
}

static void cb_wakeup(void *ud) {
  (void)ud;
  g_wakeup = true;
}

static bool cb_action(ghostty_app_t app, ghostty_target_s target,
                      ghostty_action_s action) {
  (void)app;
  (void)target;
  (void)action;
  return false;
}

static bool cb_read_clipboard(void *ud, ghostty_clipboard_e loc, void *state) {
  (void)ud;
  (void)loc;
  (void)state;
  return false;
}

static void cb_confirm_read_clipboard(void *ud, const char *str, void *state,
                                      ghostty_clipboard_request_e req) {
  (void)ud;
  (void)str;
  (void)state;
  (void)req;
}

static void cb_write_clipboard(void *ud, ghostty_clipboard_e loc,
                               const ghostty_clipboard_content_s *content,
                               size_t len, bool confirm) {
  (void)ud;
  (void)loc;
  (void)content;
  (void)len;
  (void)confirm;
}

static void cb_close_surface(void *ud, bool alive) {
  (void)ud;
  (void)alive;
}

static void pump(ghostty_app_t app, ghostty_surface_t surface, int n) {
  for (int i = 0; i < n; i++) {
    ghostty_app_tick(app);
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
    ghostty_surface_draw(surface);
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
  }
}

static bool wait_writes_contain(const char *needle, int ticks, ghostty_app_t app,
                                ghostty_surface_t surface) {
  for (int i = 0; i < ticks; i++) {
    pump(app, surface, 1);
    pthread_mutex_lock(&g_mu);
    size_t n = g_write_len;
    char buf[65536];
    memcpy(buf, g_writes, n);
    pthread_mutex_unlock(&g_mu);
    buf[n] = 0;
    if (n > 0 && strstr(buf, needle))
      return true;
  }
  return false;
}

static bool read_visible(ghostty_surface_t surface, char *out, size_t cap) {
  ghostty_selection_s sel;
  memset(&sel, 0, sizeof(sel));
  sel.top_left.tag = GHOSTTY_POINT_VIEWPORT;
  sel.top_left.coord = GHOSTTY_POINT_COORD_TOP_LEFT;
  sel.bottom_right.tag = GHOSTTY_POINT_VIEWPORT;
  sel.bottom_right.coord = GHOSTTY_POINT_COORD_BOTTOM_RIGHT;
  sel.rectangle = false;
  ghostty_text_s text = {0};
  if (!ghostty_surface_read_text(surface, sel, &text) || !text.text)
    return false;
  size_t n = text.text_len < cap - 1 ? text.text_len : cap - 1;
  memcpy(out, text.text, n);
  out[n] = 0;
  ghostty_surface_free_text(surface, &text);
  return true;
}

static size_t sample_fg(IOSurfaceRef s) {
  IOSurfaceLock(s, kIOSurfaceLockReadOnly, NULL);
  const uint8_t *base = IOSurfaceGetBaseAddress(s);
  size_t stride = IOSurfaceGetBytesPerRow(s);
  size_t w = IOSurfaceGetWidth(s), h = IOSurfaceGetHeight(s);
  uint32_t bg = *(const uint32_t *)base;
  size_t diff = 0;
  for (size_t y = 0; y < h; y += 2) {
    const uint32_t *row = (const uint32_t *)(base + y * stride);
    for (size_t x = 0; x < w; x += 2)
      if (row[x] != bg)
        diff++;
  }
  IOSurfaceUnlock(s, kIOSurfaceLockReadOnly, NULL);
  return diff;
}

int main(int argc, char **argv) {
  int fails = 0;
  if (ghostty_init((uintptr_t)argc, argv) != 0) {
    fprintf(stderr, "FAIL: ghostty_init\n");
    return 1;
  }

  ghostty_config_t config = ghostty_config_new();
  /* This session has no active CG display, so CVDisplayLinkCreateWithActiveCGDisplays
   * returns kCVReturnInvalidArgument (-6661). Ghostty maps that to error.OutOfMemory
   * when window-vsync is true (the default). Disable vsync so headless surfaces
   * can init without a WindowServer display. */
  char cfg_path[] = "/tmp/horca-ghostty-vsync-XXXXXX";
  int cfg_fd = mkstemp(cfg_path);
  if (cfg_fd >= 0) {
    const char *cfg = "window-vsync = false\n";
    write(cfg_fd, cfg, strlen(cfg));
    close(cfg_fd);
    ghostty_config_load_file(config, cfg_path);
    unlink(cfg_path);
  }
  ghostty_config_finalize(config);

  ghostty_runtime_config_s runtime = {0};
  runtime.wakeup_cb = cb_wakeup;
  runtime.action_cb = cb_action;
  runtime.read_clipboard_cb = cb_read_clipboard;
  runtime.confirm_read_clipboard_cb = cb_confirm_read_clipboard;
  runtime.write_clipboard_cb = cb_write_clipboard;
  runtime.close_surface_cb = cb_close_surface;

  ghostty_app_t app = ghostty_app_new(&runtime, config);
  if (!app) {
    fprintf(stderr, "FAIL: ghostty_app_new\n");
    return 1;
  }

  ghostty_surface_config_s sc = ghostty_surface_config_new();
  sc.platform_tag = GHOSTTY_PLATFORM_HEADLESS;
  sc.platform.headless.reserved = NULL;
  sc.scale_factor = SCALE;
  sc.io_backend = GHOSTTY_IO_BACKEND_PASSTHRU;
  sc.pty_write_cb = capture_write;
  sc.pty_resize_cb = capture_resize;

  ghostty_surface_t surface = ghostty_surface_new(app, &sc);
  if (!surface) {
    fprintf(stderr, "FAIL: ghostty_surface_new\n");
    return 1;
  }
  printf("HEADLESS_PLATFORM: PASS\n");
  printf("PASSTHRU_BACKEND: PASS\n");

  ghostty_surface_set_content_scale(surface, SCALE, SCALE);
  ghostty_surface_set_size(surface, WIDTH_PX, HEIGHT_PX);
  ghostty_surface_set_focus(surface, true);
  pump(app, surface, 20);

  pthread_mutex_lock(&g_mu);
  int resize_after_init = g_resize_n;
  uint16_t cols0 = g_cols, rows0 = g_rows;
  pthread_mutex_unlock(&g_mu);
  if (resize_after_init < 1) {
    fprintf(stderr, "FAIL: RESIZE_CALLBACK never fired on init size\n");
    fails++;
  } else {
    printf("RESIZE_CALLBACK: PASS cols=%u rows=%u w=%u h=%u n=%d\n", cols0,
           rows0, g_cb_w, g_cb_h, resize_after_init);
  }

  const char *out_bytes = MARKER "\r\n";
  ghostty_surface_pty_data(surface, (const uint8_t *)out_bytes, strlen(out_bytes));
  pump(app, surface, 40);

  char screen[8192] = {0};
  bool have_text = false;
  for (int i = 0; i < 50 && !have_text; i++) {
    pump(app, surface, 2);
    if (read_visible(surface, screen, sizeof(screen)) && strstr(screen, MARKER))
      have_text = true;
  }
  if (!have_text) {
    fprintf(stderr, "FAIL: EXTERNAL_BYTES_TO_SCREEN / READ_VISIBLE_SCREEN screen=%s\n",
            screen);
    fails++;
  } else {
    printf("EXTERNAL_BYTES_TO_SCREEN: PASS\n");
    printf("READ_VISIBLE_SCREEN: PASS marker=%s\n", MARKER);
  }

  ghostty_headless_frame_s frame = {0};
  bool have_pixels = false;
  size_t fg = 0;
  for (int i = 0; i < 80 && !have_pixels; i++) {
    pump(app, surface, 1);
    if (frame.iosurface)
      CFRelease(frame.iosurface);
    frame = ghostty_surface_headless_frame(surface);
    if (!frame.iosurface)
      continue;
    fg = sample_fg((IOSurfaceRef)frame.iosurface);
    if (fg > 50)
      have_pixels = true;
  }
  if (!have_pixels) {
    fprintf(stderr, "FAIL: METAL/IOSURFACE no foreground pixels fg=%zu\n", fg);
    fails++;
  } else {
    printf("METAL_RENDERER: PASS\n");
    printf("IOSURFACE_FRAME: PASS %ux%u scale=%.1f fg=%zu\n", frame.width_px,
           frame.height_px, frame.scale, fg);
  }
  if (frame.iosurface)
    CFRelease(frame.iosurface);

  ghostty_surface_size_s sz = ghostty_surface_size(surface);
  double x1 = sz.cell_width_px * 0.5;
  double y1 = sz.cell_height_px * 0.5;
  double x2 = sz.cell_width_px * ((double)strlen(MARKER) - 0.5);
  ghostty_surface_mouse_pos(surface, x1, y1, 0);
  ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, 0);
  ghostty_surface_mouse_pos(surface, x2, y1, 0);
  ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, 0);
  pump(app, surface, 20);

  bool sel_ok = false;
  if (ghostty_surface_has_selection(surface)) {
    ghostty_text_s sel = {0};
    if (ghostty_surface_read_selection(surface, &sel) && sel.text) {
      char sbuf[4096];
      size_t n = sel.text_len < sizeof(sbuf) - 1 ? sel.text_len : sizeof(sbuf) - 1;
      memcpy(sbuf, sel.text, n);
      sbuf[n] = 0;
      ghostty_surface_free_text(surface, &sel);
      if (strstr(sbuf, "HORCA") || strstr(sbuf, "MARKER") || strstr(sbuf, "PTY")) {
        printf("READ_SELECTION: PASS text=%s\n", sbuf);
        sel_ok = true;
      } else {
        fprintf(stderr, "FAIL: READ_SELECTION unexpected=%s\n", sbuf);
      }
    }
  }
  if (!sel_ok) {
    fprintf(stderr, "FAIL: READ_SELECTION has_selection=%d\n",
            ghostty_surface_has_selection(surface));
    fails++;
  }

  pthread_mutex_lock(&g_mu);
  g_write_len = 0;
  memset(g_writes, 0, sizeof(g_writes));
  pthread_mutex_unlock(&g_mu);

  ghostty_input_key_s key = {0};
  key.action = GHOSTTY_ACTION_PRESS;
  key.keycode = 0x00; /* kVK_ANSI_A */
  key.text = "a";
  key.unshifted_codepoint = 'a';
  ghostty_surface_key(surface, key);
  key.action = GHOSTTY_ACTION_RELEASE;
  ghostty_surface_key(surface, key);
  if (!wait_writes_contain("a", 40, app, surface)) {
    pthread_mutex_lock(&g_mu);
    g_writes[g_write_len] = 0;
    fprintf(stderr, "FAIL: KEY_TO_PTY_WRITE captured=%s len=%zu\n", g_writes,
            g_write_len);
    pthread_mutex_unlock(&g_mu);
    fails++;
  } else {
    printf("KEY_TO_PTY_WRITE: PASS\n");
  }

  pthread_mutex_lock(&g_mu);
  g_write_len = 0;
  memset(g_writes, 0, sizeof(g_writes));
  pthread_mutex_unlock(&g_mu);

  const char da[] = "\x1b[c";
  ghostty_surface_pty_data(surface, (const uint8_t *)da, sizeof(da) - 1);
  if (!wait_writes_contain("\x1b[", 60, app, surface)) {
    pthread_mutex_lock(&g_mu);
    fprintf(stderr, "FAIL: PROTOCOL_REPLY_TO_PTY_WRITE len=%zu\n", g_write_len);
    fwrite(g_writes, 1, g_write_len, stderr);
    fputc('\n', stderr);
    pthread_mutex_unlock(&g_mu);
    fails++;
  } else {
    pthread_mutex_lock(&g_mu);
    fwrite(g_writes, 1, g_write_len, stdout);
    fputc('\n', stdout);
    pthread_mutex_unlock(&g_mu);
    printf("PROTOCOL_REPLY_TO_PTY_WRITE: PASS query=ESC[c\n");
  }

  pthread_mutex_lock(&g_mu);
  int before = g_resize_n;
  pthread_mutex_unlock(&g_mu);
  ghostty_surface_set_size(surface, 1000, 500);
  pump(app, surface, 30);
  pthread_mutex_lock(&g_mu);
  int after = g_resize_n;
  uint16_t cols1 = g_cols, rows1 = g_rows;
  uint32_t w1 = g_cb_w, h1 = g_cb_h;
  pthread_mutex_unlock(&g_mu);
  if (after <= before) {
    fprintf(stderr, "FAIL: resize after set_size n=%d->%d\n", before, after);
    fails++;
  } else {
    printf("RESIZE_TO_PTY_RESIZE_CB: PASS px=1000x500 cols=%u rows=%u cb=%ux%u\n",
           cols1, rows1, w1, h1);
  }

  ghostty_surface_free(surface);
  ghostty_app_tick(app);
  ghostty_app_free(app);
  ghostty_config_free(config);
  return fails ? 1 : 0;
}
