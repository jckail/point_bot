import os
import sys
import getpass
import time
import socket
import glob
import boto3
import pandas as pd
from io import StringIO



class PointBotSetup:
    def __init__(
        self,
        pbs_cwd=os.getcwd(),
        subdirs=["data", "resources", "bots"],
        datasubdirs=["user", "reward_program_configs", "botsdata"],
        resourcessubdirs=["reward_program_configs"],
        botsubdirs=[
            "console_logger",
            "dataLayer",
            "parsed",
            "raw_html",
            "screencaps",
            "tracking_data",
        ],
        dir_config = [            
            {"data": ["user", "reward_program_configs", "botsdata"]},
            {"bots": []},
            {"resources": ["reward_program_configs","encryptionkeys"]}],
        sys_username=getpass.getuser(),
        sys_hostname=socket.gethostname(),
        userdatapath="data/user/all_users_rewards_programs.json",
        uniqueuserdatapath="data/user/",
        configpath="resources/reward_program_configs/all_config_reward_programs.json",
        encryptionkeypath="resources/encryptionkeys/",
        timestr=time.strftime("%Y%m%d%H%M%S"),
        sysplatform=sys.platform,
        ssysname=os.uname().sysname,
        version=os.uname().version,
        release=os.uname().release,
        machine=os.uname().machine,
        nodename=os.uname().nodename,
        headless = None,
        s3bucket= 'pointupdata',
        offlinemode = 0,
        point_bot_user = None
    ):
        self.pbs_cwd = pbs_cwd

        self.subdirs = subdirs
        self.datasubdirs = datasubdirs
        self.botsubdirs = botsubdirs
        self.sys_username = sys_username
        self.sys_hostname = sys_hostname
        self.userdatapath = userdatapath
        self.uniqueuserdatapath=uniqueuserdatapath
        self.configpath = configpath
        self.encryptionkeypath = encryptionkeypath
        self.timestr = timestr
        self.sysplatform = sysplatform
        self.ssysname = ssysname
        self.version = version
        self.release = release
        self.machine = machine
        self.nodename = nodename
        self.dir_config = dir_config
        self.headless = headless
        self.point_bot_user = point_bot_user
        self.s3bucket = s3bucket
        self.s3client = boto3.client('s3')
        self.offlinemode = offlinemode
        self.s3resource = boto3.resource('s3')
        self.config_df = self.pbloaddf(self.configpath)

        #this is where you would create a unique runstring that for x type of machine indicates this string
        self.system_info_dict = {
            'timestr': str(self.timestr),
            'sys_username': self.sys_username,
            'sys_hostname': self.sys_hostname,
            'sysplatform': self.sysplatform,
            'ssysname': self.ssysname,
            'version': self.version,
            'release': self.release,
            'machine': self.machine,
            'nodename': self.nodename,
            'headless' : self.headless
        }

# need to also create a create configs script! calls on 
    def create_dir(self, directory):
        directory = f"{self.pbs_cwd}/{directory}"
        if not os.path.exists(directory):
            os.makedirs(directory)
        return directory

    def create_sub_dirs(self, parent_dir, subdirs):
        return [self.create_dir(f"{parent_dir}/{subdir}") for subdir in subdirs]

    def identify_files(self,subdir = "bots",extension='_bot.py',replacer='bot'):
        return [filex.replace(extension,replacer)for filex in os.listdir(self.create_dir( subdir))if filex.endswith(extension)]

    def gen_bit_config(self):
        return [self.dir_config.append({f'data/botsdata/{x}':self.botsubdirs}) for x in self.identify_files(subdir = "bots",extension='_bot.py',replacer='bot')]
    
    def generate_directories(self):
        self.gen_bit_config()
        [[self.create_sub_dirs(y, x[y]) for y in x.keys()] for x in self.dir_config]

    def pbsaves3(self,filename,body):
        self.s3client.put_object(Body=body, Bucket=self.s3bucket, Key=filename)

    def pbloads3(self,filename):
        result = self.s3client.get_object(Bucket=self.s3bucket, Key=filename)
        return result['Body'].read().decode('utf-8')

    
    def pbsavedf(self,filename,df=pd.DataFrame(),df2=pd.DataFrame(),compress=0,printdf=0):
        try:
            if not df2.empty:
                df = pd.concat([df,df2])

            if compress ==1:
                filename = filename+'.gz'
            print(f'Saving: {filename}')

            if self.offlinemode == 1:
                print(f'Saving: "{filename}" as dataframe to local')
                if printdf ==1:
                    print(df)
                if compress == 1:
                    df.to_json(filename,orient="records",indent=4,compression='gzip')
                else:
                    df.to_json(filename,orient="records",indent=4)
            else:
                databuffer = StringIO()
                print(f'Saving: "{filename}" as dataframe to s3')
                if printdf ==1:
                    print(df)
                if compress == 1:
                    df.to_json(databuffer,orient="records",indent=4,compression='gzip')
                else:
                    df.to_json(databuffer,orient="records",indent=4)
                self.pbsaves3(filename,databuffer.getvalue())
        except Exception as e:
            print(e)

        
    def pbloaddf(self,filename,attempts=0, max_attempts=3,compress=0,printdf=0):
        if compress ==1:
            filename = filename+'.gz'
        attempts +=1 
        print(f'Loading: {filename} {attempts}/{max_attempts}')

        if attempts <= max_attempts:
            try:
                if self.offlinemode == 1:
                    if compress ==1:
                        df = pd.read_json(filename, orient="records",compression = 'gzip')
                    else:
                        df = pd.read_json(filename, orient="records")
                    print(f'Returning local file: "{filename}" as dataframe')
                    if printdf ==1:
                        print(df)
                    return df
                else:
                    if compress ==1:
                        df = pd.read_json(self.pbloads3(filename), orient="records",compression = 'gzip')
                    else:
                        df = pd.read_json(self.pbloads3(filename), orient="records")
                    print(f'Returning S3 file: "{filename}" as dataframe')
                    if printdf ==1:
                        print(df)
                    return df
            except:
                return self.pbloaddf(filename=filename, attempts=attempts)
        else:
            print(f"{filename} NOT FOUND CREATING NEW FILE")
            self.pbsavedf(filename)
            return pd.DataFrame()

    def upload_file_to_s3(self,filename,s3file = ''):
        if s3file == '':
            s3file = filename
        try:
            self.s3resource.Bucket(self.s3bucket).download_file(s3file , filename)
            print(f'loaded {filename}')

        except Exception as e:
            print(e)

    def download_file_to_s3(self,filename,s3file = ''):
        if s3file == '':
            s3file = filename
        try:
            self.s3resource.meta.client.upload_file(Filename = filename, Bucket = self.s3bucket, Key = s3file)
            print(f'loaded {filename} in s3 as {s3file}' )

        except Exception as e:
            print(e)

    def pbsavefile(self,filename,data,writetype='w+'):
        if self.offlinemode == 1:
            file = open(filename, writetype)
            print(f'saving:  {filename} to local')
            file.write(data)  # The key is type bytes still
            file.close()
        else:
            print(f'saving:  {filename} to s3')
            self.pbsaves3(filename,data)

    def pbloadfile(self,filename,data,readtype='r+',attempts=0, max_attempts=3):
        attempts += 1
        if attempts <= max_attempts:
            try:
                if self.offlinemode == 1:
                    print(f'Loading:  {filename} from Local attempts: {attempts}/{max_attempts}')
                    file = open(filename, readtype)
                    data = file.read()
                    file.close()
                    return data
                else:
                    print(f'Loading:  {filename} from s3 attempts: {attempts}/{max_attempts}')
                    return self.pbloads3(filename)
            except:
                return self.pbloadfile(filename=filename,data=data,readtype=readtype, attempts=attempts)
        else:
            raise Exception('No Key Found')

    def start(self):
        if self.offlinemode == 1:
            self.generate_directories()
        #else check for s3 bucket create if not exists
            

if __name__ == "__main__":
    pbs = PointBotSetup(offlinemode=0)
    dfObj = pd.DataFrame(columns=['User_ID', 'UserName', 'Action'])
    dfObj = dfObj.append({'User_ID': 23, 'UserName': 'Riti', 'Action': 'Login'}, ignore_index=True)
    #pbs.start()
    pbs.pbsavedf('test.json',dfObj,compress=0)
    print(pbs.pbloaddf('test.json',compress=0))




