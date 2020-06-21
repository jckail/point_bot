



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
import numpy as np
from io import BytesIO

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
        #needs to be moved  
        if new_points_column == None:
            new_points_column = points_column

        df[new_points_column] = df[points_column].apply(lambda x: int(x.split(' ')[0].replace('plus','').replace('minus','-').replace('zero','0') + x.split(' ')[1].replace(',','').replace('points','')) )
        return df

    def addmarriott(self,point_bot_user,dflist):
        try:
            botname = 'marriottbot'
            datalocationpathbase = f"data/botsdata/{botname}/parsed/{point_bot_user}_{botname.replace('bot','')}_points_parsed.json"
            
            # df_marriott = pd.read_json(datalocationpathbase, orient="records")
            df_marriott = self.pbs.pbloaddf(datalocationpathbase)
            df_marriott['rewards_program'] = 'Marriott' #add to canonicalizer
            df_marriott['point_bot_user'] = point_bot_user
            #print(df_marriott)
            df_marriott = self.fixdatecolumn(df_marriott,'start_date',fmt = '%m/%d/%Y')
            df_marriott['activity_date'] = df_marriott['start_date']
            #print(df_marriott)
            df_marriott = df_marriott.sort_values(by=['activity_date']) #add to canonicalizer
            #print(df_marriott)
            sum_col = df_marriott.groupby(['activity_date'])['total_points'].sum()
            #print(sum_col)
            df_marriott = df_marriott.set_index(['activity_date'])
            #print(df_marriott)
            df_marriott['daily_points'] = sum_col
            #print(df_marriott)
            df_marriott = df_marriott.reset_index()

            df_marriott2 = df_marriott[['point_bot_user','rewards_program','activity_date','daily_points']].drop_duplicates()
            df_marriott2['total_points_running_sum'] = df_marriott2['daily_points'].cumsum()
            
            print(df_marriott2)
            dflist.append(df_marriott2)
            print(f'{point_bot_user} has marriott data')
        except Exception as e:
            print(e)
            dflist.append(None)
            print('no marriott data', point_bot_user)
            #raise Exception('no marriott data', point_bot_user)
            
    def addsouthwest(self,point_bot_user,dflist):
        try:
            botname = 'southwestbot'
            datalocationpathbase = f"data/botsdata/{botname}/parsed/{point_bot_user}_{botname.replace('bot','')}_points_parsed.json"
            #df_southwest = pd.read_json(datalocationpathbase, orient="records")
            df_southwest = self.pbs.pbloaddf(datalocationpathbase)
            df_southwest['rewards_program'] = 'Southwest'
            df_southwest['point_bot_user'] = point_bot_user
            df_southwest['activity_date'] = df_southwest['DATE']
            df_southwest = df_southwest.sort_values(by=['activity_date'])
            df_southwest = self.fixsouthwestpoints(df_southwest,'POINTS',new_points_column= 'total_points')

            sum_col = df_southwest.groupby(['activity_date'])['total_points'].sum()
            df_southwest = df_southwest.set_index(['activity_date'])
            df_southwest['daily_points'] = sum_col
            df_southwest = df_southwest.reset_index()
            df_southwest2 = df_southwest[['point_bot_user','rewards_program','activity_date','daily_points']].drop_duplicates()
            #print(df_southwest)
            df_southwest2['total_points_running_sum'] = df_southwest2['daily_points'].cumsum()
            
            print(df_southwest2)
            dflist.append(df_southwest2)
            print(f'{point_bot_user} has southwest data')
        except Exception as e:
            print(e)
            dflist.append(None)
            print('no southwest data', point_bot_user)
            #raise Exception('no southwest data', point_bot_user)



    def main(self):
        dflist = []
        #my_list = list(set(basedf['point_bot_user'].to_list()))
        for point_bot_user in  ['alex','jkail','chuck','russ','ellen','kat']: #['russ']:['jkail','chuck','russ','ellen','kat']
            #print(point_bot_user)
            self.addmarriott(point_bot_user,dflist)
            self.addsouthwest(point_bot_user,dflist)
        df = pd.concat(dflist)
        plt.figure(figsize=(15,5))
        ax = sns.lineplot(x="activity_date", y="total_points_running_sum",  hue="rewards_program", style="point_bot_user", data=df)
        ax.axhline(0, ls='-',color='black')
        #ax.set_xticklabels(ax.get_xticklabels(), fontsize='x-large')
        pngfile = "compare points.png"
        fig = ax.get_figure()
        if self.pbs.offlinemode == 1:
            fig.savefig("compare points.png")
        else:
            img_data = BytesIO()
            plt.savefig(img_data, format='png')
            img_data.seek(0)
            self.pbs.pbsaves3(pngfile,img_data)
        df['activity_date'] = df['activity_date'].astype(str)
        self.pbs.pbsavedf(f"/Users/jordankail/projects/point_bot/src/point_bot/data/user/all_users_parsed.json",df=df)

if __name__ == '__main__':
    headless = False # note pass headless to setup so we can record
    pbs = PointBotSetup(headless = headless)
    pbs.start()
    vds = VisualizeData(pbs,'jkail')
    vds.main()