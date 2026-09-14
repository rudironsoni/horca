#include <dlfcn.h>
#include <stdlib.h>

#import <AppKit/AppKit.h>
#import <QuartzCore/CAMetalLayer.h>

typedef void* (*ghostty_surface_new_fn)(void);
typedef void (*ghostty_surface_free_fn)(void*);
typedef void (*ghostty_surface_set_occlusion_fn)(void*, bool);
typedef void (*ghostty_surface_write_fn)(void*, const char*, size_t);
typedef void (*ghostty_surface_resize_fn)(void*, uint32_t, uint32_t);

static void* g_lib = nullptr;
static ghostty_surface_new_fn g_surface_new = nullptr;
static ghostty_surface_free_fn g_surface_free = nullptr;
static ghostty_surface_set_occlusion_fn g_surface_set_occlusion = nullptr;
static ghostty_surface_write_fn g_surface_write = nullptr;
static ghostty_surface_resize_fn g_surface_resize = nullptr;

@interface OrcaGhosttyMetalView : NSView
@end

@implementation OrcaGhosttyMetalView
- (BOOL)wantsUpdateLayer {
  return YES;
}
- (CALayer*)makeBackingLayer {
  return [CAMetalLayer layer];
}
- (BOOL)isOpaque {
  return YES;
}
@end

struct OrcaGhosttySurface {
  int id;
  OrcaGhosttyMetalView* view;
  void* ghostty;
};

static constexpr int kMaxSurfaces = 64;
static OrcaGhosttySurface g_surfaces[kMaxSurfaces];
static int g_next_id = 1;

static bool loadLibghostty() {
  if (g_lib) {
    return true;
  }
  const char* path = getenv("ORCA_GHOSTTY_LIB");
  if (path == nullptr || path[0] == '\0') {
    return false;
  }
  g_lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (!g_lib) {
    return false;
  }
  g_surface_new = reinterpret_cast<ghostty_surface_new_fn>(dlsym(g_lib, "ghostty_surface_new"));
  g_surface_free = reinterpret_cast<ghostty_surface_free_fn>(dlsym(g_lib, "ghostty_surface_free"));
  g_surface_set_occlusion =
      reinterpret_cast<ghostty_surface_set_occlusion_fn>(dlsym(g_lib, "ghostty_surface_set_occlusion"));
  g_surface_write = reinterpret_cast<ghostty_surface_write_fn>(dlsym(g_lib, "ghostty_surface_write"));
  g_surface_resize =
      reinterpret_cast<ghostty_surface_resize_fn>(dlsym(g_lib, "ghostty_surface_resize"));
  return g_surface_new != nullptr && g_surface_free != nullptr;
}

extern "C" bool orca_ghostty_macos_available() {
  return loadLibghostty();
}

static OrcaGhosttySurface* findSurface(int id) {
  for (int i = 0; i < kMaxSurfaces; i += 1) {
    if (g_surfaces[i].id == id) {
      return &g_surfaces[i];
    }
  }
  return nullptr;
}

extern "C" int orca_ghostty_macos_create(void* nsview, double x, double y, double w, double h,
                                         double dpr) {
  if (!loadLibghostty() || nsview == nullptr) {
    return -1;
  }
  int slot = -1;
  for (int i = 0; i < kMaxSurfaces; i += 1) {
    if (g_surfaces[i].id == 0) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {
    return -1;
  }
  NSView* parent = (__bridge NSView*)nsview;
  CGFloat flippedY = parent.bounds.size.height - y - h;
  OrcaGhosttyMetalView* view =
      [[OrcaGhosttyMetalView alloc] initWithFrame:NSMakeRect(x, flippedY, w, h)];
  view.wantsLayer = YES;
  CAMetalLayer* layer = (CAMetalLayer*)view.layer;
  layer.contentsScale = dpr > 0 ? dpr : 1.0;
  [parent addSubview:view];
  void* ghostty = g_surface_new ? g_surface_new() : nullptr;
  if (!ghostty) {
    [view removeFromSuperview];
    return -1;
  }
  int id = g_next_id++;
  g_surfaces[slot] = {.id = id, .view = view, .ghostty = ghostty};
  return id;
}

extern "C" void orca_ghostty_macos_destroy(int id) {
  OrcaGhosttySurface* surface = findSurface(id);
  if (!surface) {
    return;
  }
  if (surface->ghostty && g_surface_free) {
    g_surface_free(surface->ghostty);
  }
  [surface->view removeFromSuperview];
  *surface = {};
}

extern "C" void orca_ghostty_macos_set_bounds(int id, double x, double y, double w, double h,
                                            double dpr) {
  OrcaGhosttySurface* surface = findSurface(id);
  if (!surface) {
    return;
  }
  NSView* parent = surface->view.superview;
  CGFloat flippedY = parent ? parent.bounds.size.height - y - h : y;
  surface->view.frame = NSMakeRect(x, flippedY, w, h);
  CALayer* layer = surface->view.layer;
  if ([layer isKindOfClass:[CAMetalLayer class]]) {
    ((CAMetalLayer*)layer).contentsScale = dpr > 0 ? dpr : 1.0;
  }
}

extern "C" void orca_ghostty_macos_set_occlusion(int id, bool occluded) {
  OrcaGhosttySurface* surface = findSurface(id);
  if (!surface) {
    return;
  }
  if (g_surface_set_occlusion && surface->ghostty) {
    g_surface_set_occlusion(surface->ghostty, occluded);
  }
  surface->view.hidden = occluded;
}

extern "C" void orca_ghostty_macos_set_visible(int id, bool visible) {
  OrcaGhosttySurface* surface = findSurface(id);
  if (!surface) {
    return;
  }
  surface->view.hidden = !visible;
}

extern "C" void orca_ghostty_macos_write(int id, const char* data, size_t len) {
  OrcaGhosttySurface* surface = findSurface(id);
  if (!surface || !g_surface_write || !surface->ghostty) {
    return;
  }
  g_surface_write(surface->ghostty, data, len);
}

extern "C" void orca_ghostty_macos_resize(int id, uint32_t cols, uint32_t rows) {
  OrcaGhosttySurface* surface = findSurface(id);
  if (!surface || !g_surface_resize || !surface->ghostty) {
    return;
  }
  g_surface_resize(surface->ghostty, cols, rows);
}
