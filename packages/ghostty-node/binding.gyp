{
  "targets": [
    {
      "target_name": "ghostty_node",
      "sources": ["src/addon.c"],
      "include_dirs": ["vendor/include"],
      "libraries": ["-lghostty-vt"],
      "library_dirs": ["vendor/lib"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "13.0"
          },
          "other_cflags": ["-O2"],
          "other_ldflags": []
        }],
        ["OS=='linux'", {
          "cflags": ["-O2", "-fPIC"],
          "ldflags": ["-pthread"]
        }],
        ["OS=='win'", {
          "libraries": ["-lghostty-vt-static.lib"]
        }]
      ]
    }
  ]
}
