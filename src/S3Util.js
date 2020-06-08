'use strict';

const AWS = require('aws-sdk')
const S3 = require('aws-sdk/clients/s3');
const s3 = new S3({apiVersion: '2006-03-01'});
const fs = require('fs');

AWS.config.getCredentials(function(err) {
  if (err) console.log(err.stack);
  // credentials not loaded
  else {
    console.log("Access key:", AWS.config.credentials.accessKeyId);
    //console.log("Secret access key:", AWS.config.credentials.secretAccessKey);
  }
});

const PRODUCTION_BUCKETS_BY_REGION = {
  'us-east-1': 'downloads.cvent.com',
  'us-west-2': 'cvent-production-legacy-s3proxy-replication-shared-us-west-2',
  'eu-central-1': 'core-app-prod-downloads-cvent-com-eu-central-1',
  'eu-west-1': 'core-app-prod-downloads-cvent-com-eu-west-1'
};

const LOWER_REGION_BUCKET = 'staging-downloads.cvent.com';

class S3Util {

  constructor(isLower) {
    // TODO: change based on viewer country
    this.bucket = isLower ? LOWER_REGION_BUCKET : BUCKETS_BY_REGION[process.env.AWS_REGION];
    this.region = isLower ? 'us-east-1' : process.env.AWS_REGION;
    if (!this.bucket || !this.bucket.trim()) {
      throw new Error("Could not get S3 bucket name from region");
    }
  }

  get s3DomainName() {
    return `${this.bucket}.s3.amazonaws.com`;
  }

  /**
   * Retrieves the image from S3
   * @param res
   * @param key
   * @returns {Promise<Body>}
   */
  async getImageAtKey(key) {
    try {
      const gor = {Bucket: this.bucket, Key: key};
      console.log(`Getting image from S3 at key ${key}`);
      let object = await s3.getObject(gor).promise();
      return Promise.resolve(object.Body);
    } catch (err) {
      console.error(`Failed to get master image from S3: ${err}`);
      return Promise.reject(err);
    }
  }

  /**
   * Write object at provided key
   * @param key
   * @param processed
   * @returns {Promise<Void>}
   */
  async writeImage(key, contentType, processed, useFileSystem) {
    let body;
    try {
      if (useFileSystem) {
        body = fs.createReadStream(processed);
      } else {
        body = processed;
      }
      // See https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.9 for Cache-Control header definition
      const por = {Bucket: this.bucket,
                   Key: key,
                   ContentType: contentType,
                   Body: body,
              // See https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.9 for Cache-Control header definition
                   CacheControl: 'no-transform, max-age=31536000, s-maxage= 2592000, immutable',
              // See https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.21
                   Expires: new Date(Date.now() + 31536000 * 1000),
              // Add tags so processed images can be deleted after 30 days
                   Tagging: 'x-cvt-retention=30'};
      console.log(`Writing image to S3 at key ${key}`);
      const start = Date.now();
      await s3.putObject(por).promise();
      const end = Date.now();
      console.log(`Writing ${key} to S3 took ${end - start} ms`);
      return Promise.resolve();
    } catch (err) {
      console.error(`Failed to get master image from S3: ${err}`);
      return Promise.reject(err);
    } finally {
      if (useFileSystem) {
        body.close();
      }
    }

  }



  /**
   * Checks whether a key exists in S3
   * @param key
   * @returns {Promise<boolean>}
   */
  async doesKeyExist(key) {
    try {
      const gor = {Bucket: this.bucket, Key: key};
      console.log(`Checking if ${this.bucket}/${key} exists `);
      let object = await s3.headObject(gor).promise();
      return Promise.resolve(object.ETag != undefined);
    } catch (err) {
      if ('NoSuchKey' === err.code || 'NotFound' === err.code || 404 === err.statusCode) {
        return false;
      }
      console.error(`Exception while checking if a ${this.bucket}/${key} exists in S3: ${err}`);
      return Promise.reject(err);
    }
  }

}

// Exports
module.exports = S3Util;
