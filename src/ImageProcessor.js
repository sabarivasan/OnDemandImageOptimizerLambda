'use strict';

const sharp = require('sharp');

class ImageProcessor {

  async processImage(imageStream, imageRequest, writeToTempFile) {
    try {
      console.log("Processing image...")
      const start = Date.now();
      let processed = await sharp(imageStream);
      if (imageRequest.needsResize()) {
        console.log(`Resizing image to ${JSON.stringify(imageRequest.resizedDimensions())}`)
        processed = processed.resize(imageRequest.resizedDimensions());
      }
      if (imageRequest.needsReformat()) {
        if (imageRequest.needsQualityReduction()) {
          console.log(`Reformating image to ${imageRequest.newImageFormat} and quality ${imageRequest.quality}`)
          processed = processed.toFormat(imageRequest.newImageFormat, {quality: imageRequest.quality})
        } else {
          console.log(`Reformating image to ${imageRequest.newImageFormat} and retaining quality`)
          processed = processed.toFormat(imageRequest.newImageFormat);
        }
      }
      let output;
      if (writeToTempFile) {
        output = `/tmp/blah${Date.now()}`;
        console.log(`Writing processed image to ${output}`)
        await processed.toFile(output);
      } else {
        console.log("Writing processed image to buffer");
        output = await processed.toBuffer();
      }
      const end = Date.now();
      console.log(`Processing ${imageRequest.masterKey} took ${end - start} ms`);
      return Promise.resolve(output);
    } catch (err) {
      console.error(`Failed to process master image: ${err}`);
      return Promise.reject(err);
    }
  }
}

// Exports
module.exports = ImageProcessor;
