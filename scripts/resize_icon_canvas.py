#!/usr/bin/env python3
from PIL import Image
import sys
import os

def add_padding(input_path, output_path, scale_factor=0.85):
    try:
        # Open source image
        img = Image.open(input_path).convert('RGBA')
        width, height = img.size
        
        # Calculate new dimensions
        new_width = int(width * scale_factor)
        new_height = int(height * scale_factor)
        
        # Resize content
        # Use LANCZOS (formerly ANTIALIAS) for high quality downsampling
        resample_method = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS
        resized_img = img.resize((new_width, new_height), resample_method)
        
        # Create new transparent canvas of original size
        canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        
        # Calculate centering position
        x_offset = (width - new_width) // 2
        y_offset = (height - new_height) // 2
        
        # Paste resized image onto canvas
        canvas.paste(resized_img, (x_offset, y_offset), resized_img)
        
        # Save result
        canvas.save(output_path, 'PNG')
        print(f"Created padded icon at {output_path} (scale: {scale_factor})")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    # Input file from generate_icon.sh default or argument
    source = "build/icon_final_cropped.png"
    dest = "build/icon_padded.png"
    
    if len(sys.argv) > 1:
        source = sys.argv[1]
    if len(sys.argv) > 2:
        dest = sys.argv[2]
        
    if not os.path.exists(source):
        print(f"Source file {source} not found!")
        sys.exit(1)
        
    add_padding(source, dest)
