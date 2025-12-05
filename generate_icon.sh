#!/bin/bash
set -e

SOURCE="build/icon_padded.png"
ICONSET="build/icon.iconset"

# Ensure source exists
if [ ! -f "$SOURCE" ]; then
    echo "Source file $SOURCE not found"
    exit 1
fi

# Create/Clean iconset directory
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Convert to base PNG 1024x1024
sips -s format png -z 1024 1024 "$SOURCE" --out "$ICONSET/icon_512x512@2x.png"

# Generate other sizes for ICNS
sips -s format png -z 16 16     "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_16x16.png"
sips -s format png -z 32 32     "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_16x16@2x.png"
sips -s format png -z 32 32     "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_32x32.png"
sips -s format png -z 64 64     "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_32x32@2x.png"
sips -s format png -z 128 128   "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_128x128.png"
sips -s format png -z 256 256   "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_128x128@2x.png"
sips -s format png -z 256 256   "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_256x256.png"
sips -s format png -z 512 512   "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_256x256@2x.png"
sips -s format png -z 512 512   "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_512x512.png"

# Create ICNS
echo "Generating icon.icns..."
iconutil -c icns "$ICONSET" -o build/icon.icns

# Create ICO (requires ImageMagick)
echo "Generating icon.ico..."
if command -v magick &> /dev/null; then
    magick "$ICONSET/icon_512x512@2x.png" -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
else
    echo "Warning: ImageMagick (magick) not found. Skipping .ico generation."
fi

# Move to root
echo "Copying icons to root..."
cp build/icon.icns icon.icns
[ -f build/icon.ico ] && cp build/icon.ico icon.ico
cp "$SOURCE" icon.png

echo "Icons generated successfully:"
echo "  - icon.icns"
echo "  - icon.ico"
echo "  - icon.png"
