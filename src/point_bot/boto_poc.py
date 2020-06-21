#!/usr/bin/env python

__author__ = 'jkail'

import pandas as p
import datetime as dt
from time import sleep
import boto3
import logging
import os




class S3Helper(object):

    def __init__(self,  local_file=None, remote_file=None, bucket= 'pointupdata'):

        self.bucket = bucket
        self.local_file = local_file
        self.local_file_save = local_file.replace('parsed','xxxx')
        self.s3_file = local_file.replace(os.getcwd()+'/','') # replace with lookup
        self.remote_file = remote_file
        self.s3 = boto3.resource('s3')

    def save_to_s3(self):
        try:
            self.s3.meta.client.upload_file(Filename = self.local_file, Bucket = self.bucket, Key = self.s3_file)
            print('saved file')

        except Exception as e:
            logging.info('------')
            # logging.error(traceback.format_exc())
            logging.info('------')
            # logging.exception(traceback.format_exc())
            logging.info('------')
            print(e)
            pass

    def get_from_s3(self):
        try:
            self.s3.Bucket(self.bucket).download_file( self.s3_file , self.local_file_save)

        except Exception as e:
            logging.info('------')
            # logging.error(traceback.format_exc())
            logging.info('------')
            # logging.exception(traceback.format_exc())
            logging.info('------')
            print(e)
            pass

if __name__ == '__main__':
    test_file = '/Users/jordankail/projects/point_bot/src/point_bot/data/user/all_users_parsed.json'
    s3_file = 'data/user/all_users_parsed.json'
    S3Helper(test_file).save_to_s3()
    S3Helper(test_file).get_from_s3()
