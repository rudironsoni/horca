{
  "targets": [
    {
      "target_name": "orca_ghostty_surface",
      "sources": ["src/ghostty_surface.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++20"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": ["src/ghostty_surface_macos.mm"],
            "libraries": [
              "-framework AppKit",
              "-framework Metal",
              "-framework QuartzCore"
            ],
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            }
          }
        ]
      ]
    }
  ]
}
