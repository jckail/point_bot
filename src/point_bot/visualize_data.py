



import os
import sys


from selenium.webdriver.common.keys import Keys
from datetime import datetime
from bs4 import BeautifulSoup
import pandas as pd
from datetime import datetime
import time
import random
from setup_point_bot import PointBotSetup
import seaborn as sns
import matplotlib.pyplot as plt


#import random_user_agent ### could use random agent


class VisualizeData:
    def __init__(  
        self,
        pbs = None,
        point_bot_user= None,
        rewards_program_name = None,
        rewards_user_email= None,
        rewards_username = None,
        rewards_user_pw = None, 
        timestr=None,
        start_url=None,
        datapath=None,
        decryptionkey = None,
        headless=True,
        **kwargs
        ):
        self.pbs = pbs
        self.point_bot_user = point_bot_user  
        self.rewards_program_name = rewards_program_name
        self.rewards_user_email = rewards_user_email
        self.rewards_username = rewards_username
        self.rewards_user_pw = rewards_user_pw
        self.run_timestr = timestr
        self.start_url = start_url
        self.datapath = datapath
        self.decryptionkey = decryptionkey
        self.headless = headless
        if self.headless == True:
            self.headless_text = '_hl' #applied to ouput files
        else:
            self.headless_text = ''

    def fixdatecolumn(self,df,date_column,new_date_column= None,fmt='%m/%d/%Y'):
        if new_date_column == None:
            new_date_column = date_column
        df[new_date_column] = df[date_column].apply(lambda x: datetime.strptime(str(x),fmt) )
        return df       

    def fixsouthwestpoints(self,df,points_column,new_points_column= None):
        if new_points_column == None:
            new_points_column = points_column

        df[new_points_column] = df[points_column].apply(lambda x: int(x.split(' ')[0].replace('plus','').replace('minus','-') + x.split(' ')[1].replace(',','')) )
        return df

    def get_data(self,point_bot_user,dflist):
        try:
            try:
                botname = 'marriottbot'
                datalocationpathbase = f"data/botsdata/{botname}/parsed/{point_bot_user}_{botname.replace('bot','')}_points_parsed.json"
                df_marriott = pd.read_json(datalocationpathbase, orient="records")
                df_marriott = df_marriott.sort_values(by=['start_date'])
                df_marriott['total_points_running_sum'] = df_marriott['total_points'].cumsum()
                df_marriott['rewards_program'] = 'Marriott'
                df_marriott = self.fixdatecolumn(df_marriott,'start_date',fmt = '%m/%d/%Y')
                df_marriott['point_bot_user'] = point_bot_user
                df_marriott2 = df_marriott[['point_bot_user','rewards_program','start_date','total_points_running_sum']]
                dflist.append(df_marriott2)
                print(f'{point_bot_user} has marriott data')
            except Exception as e:
                print(e)
                print('no marriott data', point_bot_user)
                raise Exception('no marriott data', point_bot_user)
            
            try:
                botname = 'southwestbot'
                datalocationpathbase = f"data/botsdata/{botname}/parsed/{point_bot_user}_{botname.replace('bot','')}_points_parsed.json"
                df_southwest = pd.read_json(datalocationpathbase, orient="records")
                df_southwest = df_southwest.sort_values(by=['DATE'])
                df_southwest['point_bot_user'] = point_bot_user
                df_southwest['rewards_program'] = 'Southwest'
                df_southwest['start_date'] = df_southwest['DATE']
                df_southwest = self.fixsouthwestpoints(df_southwest,'POINTS',new_points_column= 'total_points')
                df_southwest['total_points_running_sum'] = df_southwest['total_points'].cumsum()
                df_southwest2 = df_southwest[['point_bot_user','rewards_program','start_date','total_points_running_sum']]
                dflist.append(df_southwest2)
                print(f'{point_bot_user} has southwest data')
            except Exception as e:
                print(e)
                print('no southwest data', point_bot_user)
                raise Exception('no southwest data', point_bot_user)
        except Exception as e:
            print(e)


    def main(self):
        dflist = []
        for point_bot_user in ['jkail','chuck','russ','ellen']:
            print(point_bot_user)
            self.get_data(point_bot_user,dflist)
        print
        df = pd.concat(dflist)

        plt.figure(figsize=(15,5))
        ax = sns.lineplot(x="start_date", y="total_points_running_sum",  hue="rewards_program", style="point_bot_user", data=df)
        ax.axhline(0, ls='-',color='black')
        #ax.set_xticklabels(ax.get_xticklabels(), fontsize='x-large')
        ax.get_figure().savefig("compare points.png")


if __name__ == '__main__':
    headless = False # note pass headless to setup so we can record
    pbs = PointBotSetup(headless = headless)
    pbs.start()
    vds = VisualizeData(pbs,'jkail')
    vds.main()