'use strict';

const DIMENSIONS_PARAM = 'd';
const QUALITY_PARAM = 'q';
const FORMAT_PARAM = 'f';

const DIMENSIONS_REGEX = /^(\d+)x?(\d+)?$/;
const QUALITY_REGEX = /^\d+$/;
const S3_HASH_SEPARATOR = '!_!';
const S3_KEY_PARAM_SEPARATOR = '_';
const WEBP = 'webp';
const WEBP_CONTENT_TYPE = 'image/webp';
const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', WEBP, 'tiff', 'heif', 'raw'];

/**
 * This class parses the request url and headers and provides info on what image edits are requested
 */
class ImageRequest {

  constructor(imageRequestObj) {
    this.request = imageRequestObj;
    console.log(`imageRequestObj: ${JSON.stringify(imageRequestObj)}`);
  }

  static parseRequest(urlPath, queryParams, headers, customHeaders) {
    console.log(`RequestParser headers:${JSON.stringify(headers)}, customHeaders:${JSON.stringify(customHeaders)}`);
    const imageRequestObj = {};
    imageRequestObj.urlPath = urlPath;
    [imageRequestObj.imageHash, imageRequestObj.masterKey, imageRequestObj.originalFormat] = this.parseImagePath(urlPath);
    [imageRequestObj.width, imageRequestObj.height] = this.getDimensions(queryParams);
    imageRequestObj.quality = this.getQuality(queryParams);
    imageRequestObj.autoConvertToWebP = 'true' === this.safeGetHeaderValue(customHeaders, 'x-cvt-auto-convert-to-webp');
    imageRequestObj.newFormat = this.getOutputFormat(queryParams, headers, imageRequestObj.originalFormat,
                                                     imageRequestObj.autoConvertToWebP);
    return new ImageRequest(imageRequestObj);
  }

  static getDimensions(query_params) {
    let dimensionsStr = this.getParam(query_params, DIMENSIONS_PARAM);
    let width, height;
    if (dimensionsStr) {
      const match = dimensionsStr.match(DIMENSIONS_REGEX);
      if (match) {
        width = Number(match[1]);
        if (match.length > 2) {
          height = Number(match[2]);
        }
      }
    }
    return [width, height];
  }

  static getOutputFormat(query_params, headers, originalFormat, autoConvertToWebP) {
    if (!originalFormat) {
      return undefined;
    }
    // If format is requested, use it
    let newFormat = this.getParam(query_params, FORMAT_PARAM);
    if (!newFormat) {
      if (autoConvertToWebP && this.safeGetHeaderValue(headers, 'accept').includes(WEBP_CONTENT_TYPE)) {
        // If no format requested and the browser supports webp, use that
        console.log(`Auto converting to ${WEBP}`)
        newFormat = WEBP;
      } else {
        // Default to whatever format the original image is in
        newFormat = originalFormat;
        console.log(`Retaining original format ${originalFormat}`)
      }
    } else {
      newFormat = newFormat.toLowerCase();
    }
    // Ensure we support the new image format
    if (originalFormat != newFormat && (!SUPPORTED_IMAGE_FORMATS.includes(newFormat))) {
      throw new Error(`Unsupported image format:${newFormat}. Supported: ${SUPPORTED_IMAGE_FORMATS}`);
    }
    return newFormat;
  }

  static getParam(params, name) {
    let val = params[name];
    if (val && val.trim()) {
      return val.trim();
    } else {
      // Try upper case equivalent
      val = params[name.toUpperCase()];
      return val && val.trim() ? val.trim() : undefined;
    }
  }

  /**
   * Parse the url path to get image hash, master key and original format from the extension
   * @param urlPath
   * @returns {(string)[]|*[]}
   */
  static parseImagePath(urlPath) {
    const hashInd = urlPath.lastIndexOf(S3_HASH_SEPARATOR);
    const extInd = urlPath.lastIndexOf(".");
    if (hashInd < 0 || extInd < 0) {
      return [undefined, undefined, undefined];
    } else {
      let ext = urlPath.substring(extInd + 1).toLowerCase();
      return [urlPath.substring(hashInd + S3_HASH_SEPARATOR.length, extInd), // Image hash
              urlPath.substring(0, hashInd) + '.' + ext, // Get master key by removing image hash
              ext]; // Extension (image format)
    }
  }

  static getQuality(params) {
    const quality = this.getParam(params, QUALITY_PARAM);
    return quality && quality.match(QUALITY_REGEX) ? Number(quality) : undefined;
  }

  static safeGetHeaderValue(headers, name) {
    return (headers[name] && headers[name].length > 0) ? headers[name][0].value : '';
  }

  /**
   * Does this image request include resize?
   * @returns {boolean}
   */
  needsResize() {
    return this.request.width !== undefined;
  }

  /**
   * Returns an object with resized dimensions and fit type that can be passed to a Sharp image processing request
   *
   * @returns {{width: *}}
   */
  resizedDimensions() {
    let dims;
    if (this.needsResize()) {
      dims = { width: this.request.width};
      if (this.request.height) {
        dims.height = this.request.height;
        dims.fit = 'fill';
      } else {
        dims.fit = 'inside';
      }
    }
    return dims;
  }

  /**
   * Does this image request change the image format?
   * @returns {boolean}
   */
  needsReformat() {
    return this.request.newFormat !== this.request.originalFormat;
  }

  /**
   * The new image format
   * @returns {string}
   */
  get newImageFormat() {
    return 'jpg' == this.request.newFormat ? 'jpeg' : this.request.newFormat;
  }


  /**
   * Does this image request include quality reduction?
   * @returns {boolean}
   */
  needsQualityReduction() {
    return this.request.quality !== undefined;
  }

  /**
   * Returns the image quality, if requested. See {@link needsQualityReduction}
   * @returns {Number}
   */
  get quality() {
    return this.request.quality;
  }

  get masterKey() {
    return this.request.masterKey;
  }

  /**
   * Does this image request include any kind of image edits?
   * @returns {boolean}
   */
  needsImageEdits() {
    return this.needsResize() || this.needsQualityReduction() || this.needsReformat();
  }

  /**
   * Is this a valid image request?
   * - image hash is required so we know the url has a content-unique hash
   * - masterKey is required
   *
   * @returns {boolean}
   */
  isValidRequest() {
    return this.request.imageHash && this.request.masterKey && this.request.originalFormat;
  }

  /**
   * Returns the deterministic S3 key for the processed image.
   * Deterministic is crucial for maximizing CDN cache hit percentage and implies the following:
   * - The image edit params are added in alphabetical order (determinism)
   * - The image edit params are all in lower case.
   *
   * @returns {string}
   */
  s3ProcessedImageKey(masterKey, newImageFormat) {
    const extInd = masterKey.lastIndexOf('.');
    if (extInd < 0) {
      throw new Error(`Master image key ${masterKey} has no extension`);
    }
    let key = masterKey.substring(0, extInd);

    // Deterministic => The parameters have to be in alphabetical order

    // Image dimensions, if applicable
    if (this.needsResize()) {
      // Example with width: 'd400'
      // Example with width and height: 'd400x300'
      key += `${S3_KEY_PARAM_SEPARATOR}${DIMENSIONS_PARAM}${this.request.width}`;
      if (this.request.height) {
        key += `x${this.request.height}`;
      }
    }

    // Quality, if applicable
    if (this.needsQualityReduction()) {
      // Example: q80
      key += `${S3_KEY_PARAM_SEPARATOR}${QUALITY_PARAM}${this.quality}`;
    }
    return key + '.' + newImageFormat;
  }
}

// Exports
module.exports = ImageRequest;
