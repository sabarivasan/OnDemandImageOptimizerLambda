'use strict';

const S3Util = require('./S3Util.js');
const ImageRequest = require('./RequestParser');
const ImageProcessor = require('./ImageProcessor');
const querystring = require('querystring');


exports.handler = async (event, context, callback) => {
  console.log(event);

  const request = event.Records[0].cf.request;
  try {
    const key = request.uri.substr(1);
    const queryParams = querystring.parse(request.querystring);
    let customHeaders = safe(request['origin'])['s3']['customHeaders'];
    const imageRequest = ImageRequest.parseRequest(key, queryParams, request.headers, customHeaders);
    if (imageRequest.isValidRequest()) {
      // TODO: Fix this
      //const viewerCountry = countryToRegion(request.headers['cloudfront-viewer-country']);
      const s3Util = new S3Util(true);
      const imageProcessor = new ImageProcessor();

      const s3ProcessedImageKey = imageRequest.s3ProcessedImageKey(key, imageRequest.newImageFormat);
      const s3DomainName = s3Util.s3DomainName;

      // See whether the processed image already exists in S3
      if (await s3Util.doesKeyExist(s3ProcessedImageKey)) {
        // Change origin to processed image already in S3 from a previous request
        changeS3Origin(s3ProcessedImageKey);
      } else if (imageRequest.needsImageEdits() && (await s3Util.doesKeyExist(imageRequest.masterKey))) {
        // Apply edits if requested and the master image exists
        const masterImage = await s3Util.getImageAtKey(imageRequest.masterKey);
        const contentType = `image/${imageRequest.newImageFormat}`;
        const useFileSystem = 'true' === ImageRequest.safeGetHeaderValue(customHeaders, 'x-cvt-use-file-system');;
        const processed = await imageProcessor.processImage(masterImage, imageRequest, useFileSystem);
        console.log("Received processed image");
        // Write processed image to S3
        await s3Util.writeImage(s3ProcessedImageKey, contentType, processed, useFileSystem);
        changeS3Origin(s3ProcessedImageKey);
      } else {
        console.log(`No need to apply edits or master key doesn't exist at ${imageRequest.masterKey}`);
        changeS3Origin(imageRequest.masterKey);
      }

      function changeS3Origin(s3Key) {
        request.uri = '/' + s3Key;
        request.origin.s3.domainName = s3DomainName;
        request.headers['host'] = [{ key: 'host', value: s3DomainName }];

        // TODO: Do we need the following? Remove as necessary after testing DR and EU
        // request.origin.region = s3Util.region;
        // request.origin.s3.region = s3Util.region;
        // request.origin.domainName = s3DomainName;
        console.log(`Returning origin.s3.domainName=${request.origin.s3.domainName}, uri=${request.uri}`)
      }
    } else {
      console.log(`Invalid request without image hash or extension ${key}. `);
    }

    callback(null, request);
  } catch (err) {
    console.log("Error occurred while processing request: " + err);
    callback(err);
  }
}

/**
 * Translate viewer country to the region for the S3 bucket.
 * TODO: Implement this based on our S3 buckets and other Cvent requirements
 *
 * @param viewerCountry
 * @returns {string}
 */
function countryToRegion(viewerCountry) {
  return "us-east-1";
}


function safe(obj) {
  return new Proxy(obj, {
    get: function(target, name) {
      const result = target[name];
      if (!!result) {
        return (result instanceof Object)? safe(result) : result;
      }
      return safe({});
    }
  });
}
