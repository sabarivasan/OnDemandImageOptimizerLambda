const http = require('http')
const url = require('url');
const HOSTNAME = '127.0.0.1';
const PORT = 3000;


const S3Util = require('./S3Util.js');
const ImageRequest = require('./RequestParser');
const ImageProcessor = require('./ImageProcessor');
const s3Util = new S3Util('lower');
const imageProcessor = new ImageProcessor();

const server = http.createServer(async (req, res) => {
  try {
    let parsedUrl = url.parse(req.url, true);
    const key = parsedUrl.pathname.substr(1);
    const imageRequest = ImageRequest.parseRequest(key, parsedUrl.query, req.headers, req.headers);
    if (imageRequest.isValidRequest()) {
      // See whether the processed image already exists in S3
      const s3ProcessedImageKey = imageRequest.s3ProcessedImageKey(key, imageRequest.newImageFormat);
      if (await s3Util.doesKeyExist(s3ProcessedImageKey)) {
        // Change origin to processed image already in S3 from a previous request
        const s3DomainName = s3Util.s3DomainName;
        res.setHeader('host', s3DomainName);
        res.setHeader('path', s3ProcessedImageKey);
        returnImage(res, 'text/plain', `Processed image already in S3 at ${s3ProcessedImageKey}`);
      } else if (imageRequest.needsImageEdits() && (await s3Util.doesKeyExist(imageRequest.masterKey))) {
        // Apply edits if requested and the master image exists
        const masterImage = await s3Util.getImageAtKey(imageRequest.masterKey);
        let contentType = `image/${imageRequest.newImageFormat}`;
        // Apply edits if requested
        const useFileSystem = true;
        const processed = await imageProcessor.processImage(masterImage, imageRequest, useFileSystem);
        // Write processed image to S3
        await s3Util.writeImage(s3ProcessedImageKey, contentType, processed, useFileSystem);
        returnImage(res, contentType, processed);
      } else {
        // Fallback
        console.log(`No need to apply edits or master key doesn't exist at ${imageRequest.masterKey}`);
        returnImage(res, 'text/plain', `Falling back to master image in S3 at ${imageRequest.masterKey}`);
      }
    } else {
      console.log(`Invalid request without image hash or extension ${key}`);
      returnImage(res, 'text/plain', `Invalid request without image hash or extension ${key}`);
    }
  } catch (e) {
    return returnError(res, 500, "unable to resize image " + e);
  }
})

function returnError(res, statusCode, message) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'text/plain')
  res.end(message)
}

function returnImage(res, mimeType, processedImage) {
  res.statusCode = 200
  res.setHeader('content-type', mimeType)
  res.end(processedImage)
}

server.listen(PORT, HOSTNAME, () => {
  console.log(`Server running at http://${HOSTNAME}:${PORT}/`);
})

