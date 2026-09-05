#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <ghostty/vt.h>

typedef struct {
  GhosttyTerminal term;
  napi_ref reply_ref;
  napi_ref title_ref;
  napi_ref pwd_ref;
  napi_env env;
} GhosttyCtx;

static void write_pty_cb(GhosttyTerminal term, void *userdata,
                         const uint8_t *data, size_t len) {
  (void)term;
  GhosttyCtx *ctx = (GhosttyCtx *)userdata;
  if (!ctx || !ctx->reply_ref) return;
  void *buf = NULL;
  napi_value buf_val;
  if (napi_create_buffer_copy(ctx->env, len, (const char *)data, &buf, &buf_val) !=
      napi_ok)
    return;
  napi_value global, cb;
  napi_get_global(ctx->env, &global);
  napi_get_reference_value(ctx->env, ctx->reply_ref, &cb);
  napi_call_function(ctx->env, global, cb, 1, &buf_val, NULL);
}

static void emit_str_cb(GhosttyTerminal term, void *userdata, napi_ref ref,
                        GhosttyTerminalData data_key) {
  GhosttyCtx *ctx = (GhosttyCtx *)userdata;
  if (!ctx || !ref) return;
  GhosttyString str = {0};
  if (ghostty_terminal_get(term, data_key, &str) != GHOSTTY_SUCCESS) return;
  napi_value cb, global, out;
  napi_get_global(ctx->env, &global);
  napi_get_reference_value(ctx->env, ref, &cb);
  if (str.len > 0) {
    void *p = NULL;
    napi_create_buffer_copy(ctx->env, str.len, (const char *)str.ptr, &p, &out);
  } else {
    napi_get_null(ctx->env, &out);
  }
  napi_call_function(ctx->env, global, cb, 1, &out, NULL);
}

static void title_cb(GhosttyTerminal term, void *userdata) {
  GhosttyCtx *ctx = (GhosttyCtx *)userdata;
  if (!ctx) return;
  emit_str_cb(term, userdata, ctx->title_ref, GHOSTTY_TERMINAL_DATA_TITLE);
}

static void pwd_cb(GhosttyTerminal term, void *userdata) {
  GhosttyCtx *ctx = (GhosttyCtx *)userdata;
  if (!ctx) return;
  emit_str_cb(term, userdata, ctx->pwd_ref, GHOSTTY_TERMINAL_DATA_PWD);
}

static void finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  GhosttyCtx *ctx = (GhosttyCtx *)data;
  if (!ctx) return;
  if (ctx->term) ghostty_terminal_free(ctx->term);
  if (ctx->reply_ref) napi_delete_reference(ctx->env, ctx->reply_ref);
  if (ctx->title_ref) napi_delete_reference(ctx->env, ctx->title_ref);
  if (ctx->pwd_ref) napi_delete_reference(ctx->env, ctx->pwd_ref);
  free(ctx);
}

static napi_value term_feed(napi_env env, napi_callback_info info);
static napi_value term_resize(napi_env env, napi_callback_info info);
static napi_value term_snapshot(napi_env env, napi_callback_info info);
static napi_value term_dispose(napi_env env, napi_callback_info info);

static GhosttyCtx *unwrap(napi_env env, napi_callback_info info) {
  napi_value js_this;
  napi_get_cb_info(env, info, NULL, NULL, &js_this, NULL);
  GhosttyCtx *ctx = NULL;
  napi_unwrap(env, js_this, (void **)&ctx);
  return ctx;
}

static void get_u32_prop(napi_env env, napi_value opts, const char *key,
                         uint32_t *out, uint32_t dflt) {
  napi_value val;
  napi_valuetype t;
  if (opts && napi_get_named_property(env, opts, key, &val) == napi_ok &&
      napi_typeof(env, val, &t) == napi_ok && t == napi_number) {
    napi_get_value_uint32(env, val, out);
  } else {
    *out = dflt;
  }
}

static void get_i64_prop(napi_env env, napi_value opts, const char *key,
                         int64_t *out, int64_t dflt) {
  napi_value val;
  napi_valuetype t;
  if (opts && napi_get_named_property(env, opts, key, &val) == napi_ok &&
      napi_typeof(env, val, &t) == napi_ok && t == napi_number) {
    napi_get_value_int64(env, val, out);
  } else {
    *out = dflt;
  }
}

static void attach_cb(napi_env env, napi_value opts, const char *key,
                      napi_ref *ref) {
  napi_value cb;
  napi_valuetype t;
  if (opts && napi_get_named_property(env, opts, key, &cb) == napi_ok &&
      napi_typeof(env, cb, &t) == napi_ok && t == napi_function) {
    napi_create_reference(env, cb, 1, ref);
  }
}

static napi_value term_new(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_value opts = argc > 0 ? argv[0] : NULL;

  uint32_t cols, rows;
  int64_t scrollback;
  get_u32_prop(env, opts, "cols", &cols, 80);
  get_u32_prop(env, opts, "rows", &rows, 24);
  get_i64_prop(env, opts, "scrollbackLimit", &scrollback, 5000);
  if (cols == 0) cols = 80;
  if (rows == 0) rows = 24;

  GhosttyTerminalOptions o = {0};
  o.cols = (uint16_t)cols;
  o.rows = (uint16_t)rows;
  o.max_scrollback = (size_t)(scrollback > 0 ? scrollback : 0);

  GhosttyCtx *ctx = (GhosttyCtx *)calloc(1, sizeof(GhosttyCtx));
  if (!ctx) {
    napi_throw_error(env, NULL, "alloc failed");
    return NULL;
  }
  ctx->env = env;
  GhosttyTerminal term = NULL;
  if (ghostty_terminal_new(NULL, &term, o) != GHOSTTY_SUCCESS) {
    free(ctx);
    napi_throw_error(env, NULL, "ghostty_terminal_new failed");
    return NULL;
  }
  ctx->term = term;
  ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_USERDATA, ctx);
  ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_WRITE_PTY, write_pty_cb);
  ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_TITLE_CHANGED, title_cb);
  ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_PWD_CHANGED, pwd_cb);

  attach_cb(env, opts, "onReply", &ctx->reply_ref);
  attach_cb(env, opts, "onTitleChanged", &ctx->title_ref);
  attach_cb(env, opts, "onPwdChanged", &ctx->pwd_ref);

  napi_value result;
  napi_create_object(env, &result);
  napi_wrap(env, result, ctx, finalize, NULL, NULL);

  napi_property_descriptor methods[] = {
      {"feed", NULL, term_feed, NULL, NULL, NULL, napi_default, NULL},
      {"resize", NULL, term_resize, NULL, NULL, NULL, napi_default, NULL},
      {"snapshot", NULL, term_snapshot, NULL, NULL, NULL, napi_default, NULL},
      {"dispose", NULL, term_dispose, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, result, sizeof(methods) / sizeof(*methods),
                         methods);
  return result;
}

static napi_value term_feed(napi_env env, napi_callback_info info) {
  GhosttyCtx *ctx = unwrap(env, info);
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_value u;
  napi_get_undefined(env, &u);
  if (ctx == NULL || !ctx->term || argc < 1) return u;
  void *data = NULL;
  size_t len = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &len) != napi_ok) return u;
  ghostty_terminal_vt_write(ctx->term, (const uint8_t *)data, len);
  return u;
}

static napi_value term_resize(napi_env env, napi_callback_info info) {
  GhosttyCtx *ctx = unwrap(env, info);
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  uint32_t cols = 0, rows = 0;
  if (argc > 0) napi_get_value_uint32(env, argv[0], &cols);
  if (argc > 1) napi_get_value_uint32(env, argv[1], &rows);
  napi_value u;
  napi_get_undefined(env, &u);
  if (ctx == NULL || !ctx->term) return u;
  ghostty_terminal_resize(ctx->term, (uint16_t)cols, (uint16_t)rows, 8, 16);
  return u;
}

static napi_value term_snapshot(napi_env env, napi_callback_info info) {
  GhosttyCtx *ctx = unwrap(env, info);
  napi_value obj;
  napi_create_object(env, &obj);
  if (ctx == NULL || !ctx->term) return obj;

  GhosttyFormatterTerminalOptions fopts =
      GHOSTTY_INIT_SIZED(GhosttyFormatterTerminalOptions);
  fopts.emit = GHOSTTY_FORMATTER_FORMAT_VT;
  fopts.extra = GHOSTTY_INIT_SIZED(GhosttyFormatterTerminalExtra);
  fopts.extra.screen = GHOSTTY_INIT_SIZED(GhosttyFormatterScreenExtra);

  GhosttyFormatter fmt = NULL;
  if (ghostty_formatter_terminal_new(NULL, &fmt, ctx->term, fopts) ==
      GHOSTTY_SUCCESS) {
    uint8_t *buf = NULL;
    size_t len = 0;
    if (ghostty_formatter_format_alloc(fmt, NULL, &buf, &len) == GHOSTTY_SUCCESS &&
        buf != NULL) {
      napi_value v;
      napi_create_string_utf8(env, (const char *)buf, len, &v);
      napi_set_named_property(env, obj, "vt", v);
      ghostty_free(NULL, buf, len);
    }
    ghostty_formatter_free(fmt);
  }

  uint16_t cx = 0, cy = 0, dc = 0, dr = 0;
  if (ghostty_terminal_get(ctx->term, GHOSTTY_TERMINAL_DATA_CURSOR_X, &cx) ==
          GHOSTTY_SUCCESS &&
      ghostty_terminal_get(ctx->term, GHOSTTY_TERMINAL_DATA_CURSOR_Y, &cy) ==
          GHOSTTY_SUCCESS) {
    napi_value c;
    napi_create_object(env, &c);
    napi_value x, y;
    napi_create_uint32(env, cx, &x);
    napi_create_uint32(env, cy, &y);
    napi_set_named_property(env, c, "x", x);
    napi_set_named_property(env, c, "y", y);
    napi_set_named_property(env, obj, "cursor", c);
  }
  if (ghostty_terminal_get(ctx->term, GHOSTTY_TERMINAL_DATA_COLS, &dc) ==
          GHOSTTY_SUCCESS &&
      ghostty_terminal_get(ctx->term, GHOSTTY_TERMINAL_DATA_ROWS, &dr) ==
          GHOSTTY_SUCCESS) {
    napi_value cols, rows;
    napi_create_uint32(env, dc, &cols);
    napi_create_uint32(env, dr, &rows);
    napi_set_named_property(env, obj, "cols", cols);
    napi_set_named_property(env, obj, "rows", rows);
  }

  GhosttyTerminalScreen alt = 0;
  if (ghostty_terminal_get(ctx->term, GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN, &alt) ==
      GHOSTTY_SUCCESS) {
    napi_value v;
    napi_get_boolean(env, alt == GHOSTTY_TERMINAL_SCREEN_ALTERNATE, &v);
    napi_set_named_property(env, obj, "alternateScreen", v);
  }

  GhosttyTerminalScrollbar sb = {0};
  if (ghostty_terminal_get(ctx->term, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &sb) ==
      GHOSTTY_SUCCESS) {
    napi_value s;
    napi_create_object(env, &s);
    napi_value off, lenv;
    napi_create_int64(env, (int64_t)sb.offset, &off);
    napi_create_int64(env, (int64_t)sb.len, &lenv);
    napi_set_named_property(env, s, "offset", off);
    napi_set_named_property(env, s, "len", lenv);
    napi_set_named_property(env, obj, "scrollbar", s);
  }

  return obj;
}

static napi_value term_dispose(napi_env env, napi_callback_info info) {
  GhosttyCtx *ctx = unwrap(env, info);
  if (ctx != NULL && ctx->term) {
    ghostty_terminal_free(ctx->term);
    ctx->term = NULL;
  }
  napi_value u;
  napi_get_undefined(env, &u);
  return u;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor exp[] = {
      {"createTerminal", NULL, term_new, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(exp) / sizeof(*exp), exp);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
