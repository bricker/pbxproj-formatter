## pbxproj formatter

This is a Javascript port of [this beautiful perl script](https://github.com/WebKit/WebKit/blob/main/Tools/Scripts/sort-Xcode-project-file). This was the only zero-dependency solution I found to keeping our pbxproj files deterministically formatted.

It will also resolve conflicting versions. This is useful if you use the "union" merge strategy for this file and end up with multiple "CURRENT_PROJECT_VERSION" lines.
