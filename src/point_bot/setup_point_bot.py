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
        datasubdirs=["user",  "botsdata"],
        resourcessubdirs=["reward_program_configs"],
        botsubdirs=[
            "console_logger",
            "dataLayer",
            "parsed",
            "raw_html",
            "screencaps",
            "tracking_data",
            "scripts"
        ],
        dir_config = [            
            {"data": ["user", "reward_program_configs", "botsdata"]},
            {"bots": []},
            {"resources": ["reward_program_configs","encryptionkeys",'param_history']}],
        sys_username=getpass.getuser(),
        sys_hostname=socket.gethostname(),
        userdatapath="data/user/all_users_rewards_programs.json",
        uniqueuserdatapath="data/user/",
        configpath="resources/reward_program_configs/all_config_reward_programs.json",
        encryptionkeypath="resources/encryptionkeys/",
        paramhistorypath="resources/param_history/",
        timestr=time.strftime("%Y%m%d%H%M%S"),
        sysplatform=sys.platform,
        ssysname=os.uname().sysname,
        version=os.uname().version,
        release=os.uname().release,
        machine=os.uname().machine,
        nodename=os.uname().nodename,
        headless = True,
        s3bucket= 'pointupdata',
        offlinemode = 0,
        point_bot_user = None,
        runspecificbots = []
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
        self.paramhistorypath = paramhistorypath
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
        self.configured_reward_programs = self.config_df['rewards_program_name'].tolist()
        
        if runspecificbots == []:
            self.botstorun = self.configured_reward_programs
        else:
            self.botstorun = runspecificbots
        
        #        for configured_reward_program in self.configured_reward_programs:
            # if configured_reward_program in self.botstorun:
            #     self.user_rewards_info_df[configured_reward_program] = 1
            # else:
            #     self.user_rewards_info_df[configured_reward_program] = 1
        #put logic on config_df to control what is run via iloc

        #this is where you would create a unique runstring that for x type of machine indicates this string
        if runspecificbots == []:
            self.config_df['run'] = 1
        else:
            self.config_df['run'] = 0
            
            for bottorun in runspecificbots:
                self.config_df.loc[self.config_df.rewards_program_name == bottorun, 'run'] = 1
        #print(self.config_df)
        

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

        if self.point_bot_user != None:
            self.unique_user_file = self.uniqueuserdatapath + f'{self.point_bot_user}_rewards_programs.json'
            self.user_rewards_info_df = self.pbloaddf(self.unique_user_file)
        else:
            self.unique_user_file = ''
            self.user_rewards_info_df = None

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

    def pbloadfile(self,filename,readtype='r+',attempts=0, max_attempts=3):
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
                return self.pbloadfile(filename=filename,readtype=readtype, attempts=attempts)
        else:
            raise Exception('No Key Found')

    def start(self):
        if self.offlinemode == 1:
            self.generate_directories()
        #else check for s3 bucket create if not exists

    def selectparameters(self):
        self.user_rewards_info_df = self.user_rewards_info_df.sort_values(by=['rewards_program_name','created_time','last_successful_login_time'], ascending=False)
        self.user_rewards_info_df['best_record_rank'] =self.user_rewards_info_df.groupby("rewards_program_name")['last_successful_login_time'].rank(ascending = True, method = 'max') + self.user_rewards_info_df.groupby("rewards_program_name")['last_successful_login_time'].rank(ascending = True, method = 'max')
        self.user_rewards_info_df['best_record_rank'] =self.user_rewards_info_df.groupby("rewards_program_name")['best_record_rank'].rank(ascending = False, method = 'max')
        self.user_rewards_info_df = self.user_rewards_info_df.sort_values(by=['rewards_program_name','best_record_rank'], ascending=True).reset_index(drop=True)
        
        

        self.user_rewards_info_df['sys_username'] = self.sys_username
        self.user_rewards_info_df['sys_hostname'] = self.sys_hostname
        self.user_rewards_info_df['sysplatform'] = self.sysplatform
        self.user_rewards_info_df['ssysname'] = self.ssysname
        self.user_rewards_info_df['version'] = self.version
        self.user_rewards_info_df['release'] = self.release
        self.user_rewards_info_df['machine'] = self.machine
        self.user_rewards_info_df['nodename'] = self.nodename
        self.user_rewards_info_df['timestr'] = str(self.timestr)
        self.user_rewards_info_df['headless'] = self.headless

        self.user_rewards_info_df =self.user_rewards_info_df.merge(self.config_df,how='inner',on='rewards_program_name')        
        
        #print(self.user_rewards_info_df[["rewards_program_name","run"]])
        self.user_rewards_info_df.loc[(self.user_rewards_info_df['run'] == 1)&(self.user_rewards_info_df['best_record_rank'] == 1.0), 'run'] =1
        #print(self.user_rewards_info_df)
        #print(self.user_rewards_info_df)
        #print(self.user_rewards_info_df[["rewards_program_name","run"]])
        #exit(1)
        return self.user_rewards_info_df.to_dict(orient='records')

    def closeoutfunction(self):
        self.pbsavedf(self.paramhistorypath+self.point_bot_user+self.timestr+'run_history.json',self.user_rewards_info_df)
        newuserfiledf = self.user_rewards_info_df[[
            "point_bot_user"
            ,"rewards_program_name"
            ,"rewards_user_email"
            ,"rewards_username"
            ,"rewards_user_pw"
            ,"created_time"
            ,"altered_time"
            ,"valid"
            ,"last_successful_login_time"
            ,"last_successful_login_run_timestr"
            ,"times_accessed"
            ,"decryptionkey"]]
        self.pbsavedf(self.unique_user_file,newuserfiledf,printdf=0)

if __name__ == "__main__":
    pbs = PointBotSetup(offlinemode=0)
    dfObj = pd.DataFrame(columns=['User_ID', 'UserName', 'Action'])
    dfObj = dfObj.append({'User_ID': 23, 'UserName': 'Riti', 'Action': 'Login'}, ignore_index=True)
    #pbs.start()
    pbs.pbsavedf('test.json',dfObj,compress=0)
    print(pbs.pbloaddf('test.json',compress=0))




