import os
import sys
import pandas as pd
import time

## this should join user and bot configuration data ## 
## Add in ability to look up bot parameters based on 
## Add in ability to look up bot parameters based on 
class PointBotProfileParameters:
    def __init__(
        self,
        point_bot_user,
        userdatapath="data/user/all_users_rewards_programs.json",
        configpath="resources/reward_program_configs/all_config_reward_programs.json",
        timestr=None,
    ):

        self.point_bot_user = point_bot_user
        self.userdata_path = userdatapath
        self.configpath = configpath
        self.run_timestr = timestr
        if self.run_timestr == None:
            self.run_timestr = time.strftime("%Y%m%d%H%M%S")
        self.userdata_df = pd.read_json(self.userdata_path, orient="records")[
            pd.read_json(self.userdata_path, orient="records")["point_bot_user"]
            == self.point_bot_user
        ]       
        self.output_userdata_df = pd.DataFrame()
        self.system_info_dict = {
            "sys.platform": sys.platform,
            "sysname": os.uname().sysname,
            "version": os.uname().version,
            "release": os.uname().release,
            "machine": os.uname().machine,
            "nodename": os.uname().nodename,
            "run_timestr" : self.run_timestr,
        }
        self.config_df = pd.read_json(self.configpath, orient="records")
        #print(f' \n {self.system_info_dict} \n\n\n' )

        
        
        self.userdata_df = self.userdata_df.sort_values(by=['rewards_program_name','created_time','last_successful_login_time'], ascending=False)
        #print(f' userdata: \n {self.userdata_df} \n' )
        self.userdata_df['best_record_rank'] =self.userdata_df.groupby("rewards_program_name")['last_successful_login_time'].rank(ascending = True, method = 'max') + self.userdata_df.groupby("rewards_program_name")['last_successful_login_time'].rank(ascending = True, method = 'max')
        self.userdata_df['best_record_rank'] =self.userdata_df.groupby("rewards_program_name")['best_record_rank'].rank(ascending = False, method = 'max')
        self.userdata_df = self.userdata_df.sort_values(by=['rewards_program_name','best_record_rank'], ascending=True).reset_index(drop=True)
        
        self.output_userdata_df = self.userdata_df[self.userdata_df['best_record_rank'] == 1.0].copy()
        self.output_userdata_df['sys.platform'] = self.system_info_dict['sys.platform']
        self.output_userdata_df['sysname'] = self.system_info_dict['sysname']
        self.output_userdata_df['version'] = self.system_info_dict['version']
        self.output_userdata_df['release'] = self.system_info_dict['release']
        self.output_userdata_df['machine'] = self.system_info_dict['machine']
        self.output_userdata_df['nodename'] = self.system_info_dict['nodename']
        self.output_userdata_df['run_timestr'] = self.system_info_dict['run_timestr']
        #print(f' output: \n\n\n {self.config_df} \n' )
        self.output_userdata_df =self.output_userdata_df.merge(self.config_df,how='inner',on='rewards_program_name')
        #print(f' output: \n\n\n {self.output_userdata_df} \n' )
        
        self.parameter_list = self.output_userdata_df.to_dict(orient='records')
        #print(self.parameter_list)
        #for reward in x time_track_dict['file_prefix'] = system_info_dict
        
        ##add lookup per 


if __name__ == "__main__":

    pbp = PointBotProfileParameters(
        "jkail", userdatapath="data/user/all_users_rewards_programs_testing.json"
    )
    
    # pbd.startupdriver()

