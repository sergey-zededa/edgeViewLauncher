#!/usr/bin/env python3
from PIL import Image
import sys

# Open the image
img = Image.open('edgeViewLauncher.png').convert('RGBA')

# Get pixel data
pixdata = img.load()

# Replace white background with transparency
width, height = img.size
for y in range(height):
    for x in range(width):
        r, g, b, a = pixdata[x, y]
        # If pixel is white or very close to white, make it transparent
        if r > 240 and g > 240 and b > 240:
            pixdata[x, y] = (r, g, b, 0)

# Save with transparency
img.save('build/icon_transparent.png', 'PNG')
print("Transparent icon created at build/icon_transparent.png")
