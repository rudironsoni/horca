// CI-only diagnostic for the adversarial shutdown abort.
// Loaded into the Electron process before production-shutdown.js.
// Not a product fix and not part of the shutdown sequence.
//
// An uncaught Napi::Error becomes std::terminate inside libc++abi. A JavaScript
// uncaughtException handler does not run. This handler prints what() and a
// native backtrace, then chains to the previous terminate handler so the
// process still aborts (exit 134).

#include <cxxabi.h>
#include <exception>
#include <execinfo.h>
#include <cstdio>
#include <cstdlib>
#include <node_api.h>

static std::terminate_handler previous = nullptr;
static int handling = 0;

static void PrintTerminate() {
  std::fputs("HORCA_TERMINATE\n", stderr);
  if (const std::type_info* type = abi::__cxa_current_exception_type()) {
    int status = 0;
    char* demangled = abi::__cxa_demangle(type->name(), nullptr, nullptr, &status);
    std::fprintf(stderr, "HORCA_TERMINATE_TYPE %s\n", demangled != nullptr ? demangled : type->name());
    std::free(demangled);
  } else {
    std::fputs("HORCA_TERMINATE_TYPE <none>\n", stderr);
  }

  const std::exception_ptr current = std::current_exception();
  if (!current) {
    std::fputs("Napi::Error::what(): <no current_exception>\n", stderr);
  } else {
    try {
      std::rethrow_exception(current);
    } catch (const std::exception& error) {
      const char* message = error.what();
      std::fprintf(stderr, "Napi::Error::what(): %s\n", message != nullptr ? message : "<null>");
    } catch (...) {
      std::fputs("Napi::Error::what(): <non-std exception>\n", stderr);
    }
  }

  void* frames[128];
  const int count = backtrace(frames, 128);
  char** symbols = backtrace_symbols(frames, count);
  if (symbols == nullptr) {
    std::fputs("HORCA_NATIVE_BACKTRACE <unavailable>\n", stderr);
  } else {
    for (int i = 0; i < count; i++) {
      std::fprintf(stderr, "HORCA_NATIVE_BACKTRACE %s\n", symbols[i]);
    }
    std::free(symbols);
  }
  std::fflush(stderr);
}

static void OnTerminate() {
  if (handling) {
    std::abort();
  }
  handling = 1;
  PrintTerminate();
  if (previous != nullptr && previous != OnTerminate) {
    previous();
  }
  std::abort();
}

static napi_value Install(napi_env env, napi_value exports) {
  previous = std::set_terminate(OnTerminate);
  std::fputs("HORCA_TERMINATE_DIAG_LOADED\n", stderr);
  std::fflush(stderr);
  return exports;
}

NAPI_MODULE(horca_terminate_diag, Install)
