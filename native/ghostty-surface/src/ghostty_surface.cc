#include <napi.h>

#include <string>

#ifdef __APPLE__
extern "C" {
bool orca_ghostty_macos_available();
int orca_ghostty_macos_create(void* nsview, double x, double y, double w, double h, double dpr);
void orca_ghostty_macos_destroy(int id);
void orca_ghostty_macos_set_bounds(int id, double x, double y, double w, double h, double dpr);
void orca_ghostty_macos_set_occlusion(int id, bool occluded);
void orca_ghostty_macos_set_visible(int id, bool visible);
void orca_ghostty_macos_write(int id, const char* data, size_t len);
void orca_ghostty_macos_resize(int id, uint32_t cols, uint32_t rows);
}
#endif

namespace {

#ifdef __APPLE__
bool ParseBounds(const Napi::Value& value, double* x, double* y, double* w, double* h, double* dpr) {
  if (!value.IsObject()) {
    return false;
  }
  auto bounds = value.As<Napi::Object>();
  if (!bounds.Has("x") || !bounds.Has("y") || !bounds.Has("width") || !bounds.Has("height")) {
    return false;
  }
  *x = bounds.Get("x").As<Napi::Number>().DoubleValue();
  *y = bounds.Get("y").As<Napi::Number>().DoubleValue();
  *w = bounds.Get("width").As<Napi::Number>().DoubleValue();
  *h = bounds.Get("height").As<Napi::Number>().DoubleValue();
  *dpr = bounds.Has("dpr") ? bounds.Get("dpr").As<Napi::Number>().DoubleValue() : 1.0;
  return *w > 0 && *h > 0;
}
#endif

Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  return Napi::Boolean::New(info.Env(), orca_ghostty_macos_available());
#else
  // Linux stays on the glibc 2.31 floor; native GL is only used when libghostty
  // can host a child surface without GTK-the-app. Windows is the same until a
  // GL/DX host exists. Both use in-process GPU over libghostty-vt until then.
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
#endif
}

Napi::Value Create(const Napi::CallbackInfo& info) {
  auto env = info.Env();
#ifndef __APPLE__
  Napi::Error::New(env, "native Ghostty GPU surface is unavailable on this host").ThrowAsJavaScriptException();
  return env.Null();
#else
  if (info.Length() < 2 || !info[0].IsBuffer() || !orca_ghostty_macos_available()) {
    Napi::Error::New(env, "native Ghostty GPU surface requires a window handle and libghostty")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  double x = 0, y = 0, w = 0, h = 0, dpr = 1;
  if (!ParseBounds(info[1], &x, &y, &w, &h, &dpr)) {
    Napi::TypeError::New(env, "create(handle, bounds)").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "nativeWindowHandle is too small").ThrowAsJavaScriptException();
    return env.Null();
  }
  void* nsview = *reinterpret_cast<void**>(buffer.Data());
  int id = orca_ghostty_macos_create(nsview, x, y, w, h, dpr);
  if (id <= 0) {
    Napi::Error::New(env, "libghostty Metal surface could not be created").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, id);
#endif
}

Napi::Value Destroy(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  if (info.Length() >= 1 && info[0].IsNumber()) {
    orca_ghostty_macos_destroy(info[0].As<Napi::Number>().Int32Value());
  }
#else
  (void)info;
#endif
  return info.Env().Undefined();
}

Napi::Value SetBounds(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  if (info.Length() >= 2 && info[0].IsNumber()) {
    double x = 0, y = 0, w = 0, h = 0, dpr = 1;
    if (ParseBounds(info[1], &x, &y, &w, &h, &dpr)) {
      orca_ghostty_macos_set_bounds(info[0].As<Napi::Number>().Int32Value(), x, y, w, h, dpr);
    }
  }
#else
  (void)info;
#endif
  return info.Env().Undefined();
}

Napi::Value SetOcclusion(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  if (info.Length() >= 2 && info[0].IsNumber()) {
    orca_ghostty_macos_set_occlusion(info[0].As<Napi::Number>().Int32Value(),
                                    info[1].ToBoolean().Value());
  }
#else
  (void)info;
#endif
  return info.Env().Undefined();
}

Napi::Value SetVisible(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  if (info.Length() >= 2 && info[0].IsNumber()) {
    orca_ghostty_macos_set_visible(info[0].As<Napi::Number>().Int32Value(),
                                   info[1].ToBoolean().Value());
  }
#else
  (void)info;
#endif
  return info.Env().Undefined();
}

Napi::Value Write(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsString()) {
    std::string data = info[1].As<Napi::String>().Utf8Value();
    orca_ghostty_macos_write(info[0].As<Napi::Number>().Int32Value(), data.data(), data.size());
  }
#else
  (void)info;
#endif
  return info.Env().Undefined();
}

Napi::Value Resize(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  if (info.Length() >= 3 && info[0].IsNumber()) {
    orca_ghostty_macos_resize(info[0].As<Napi::Number>().Int32Value(),
                             info[1].As<Napi::Number>().Uint32Value(),
                             info[2].As<Napi::Number>().Uint32Value());
  }
#else
  (void)info;
#endif
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  exports.Set("setBounds", Napi::Function::New(env, SetBounds));
  exports.Set("setOcclusion", Napi::Function::New(env, SetOcclusion));
  exports.Set("setVisible", Napi::Function::New(env, SetVisible));
  exports.Set("write", Napi::Function::New(env, Write));
  exports.Set("resize", Napi::Function::New(env, Resize));
  return exports;
}

}  // namespace

NODE_API_MODULE(orca_ghostty_surface, Init)
