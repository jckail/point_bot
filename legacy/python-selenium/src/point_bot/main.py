#!/usr/bin/env python3.8

import pandas as pd

from setup_point_bot import PointBotSetup
from pointbotencryption import PointBotEncryption
from fetch_profile import Point_Bot_User

from marriott_bot import MarriottBot
from southwest_bot import SouthwestBot
from united_bot import UnitedBot
from hyatt_bot import HyattBot
from delta_bot import DeltaBot
from mgm_bot import MgmBot
from americanairlines_bot import AmericanAirlinesBot
from test_bot import TestBot
from visualize_data import VisualizeData

# from xvfbwrapper import Xvfb
# from pyvirtualdisplay import Display
#sudo apt install xvfb
#pip3.8 install xvfbwrapper

if __name__ == "__main__":
    headless = False # note pass headless to setup so we can record
    #pass users up here  ['jkail','chuck','alex','ellen','kat','russ']: #"jkail", "ellen"'chuck' 'jkail',
    #for user in ['jkail','chuck','alex','ellen','kat','russ']:#['jkail','chuck','alex','ellen','kat','russ']:
    for user in ['chuck']:#['jkail','chuck','alex','ellen','kat','russ']: #
        pbs = PointBotSetup(  point_bot_user=user,headless = headless,offlinemode=0,runspecificbots = ['Hyatt']) # ,runspecificbots = ['Southwest']['Marriott','Southwest','United','Test']
        pbs.start()
        print(f'\n\n\n Headless = {headless} \n\n\n ') 

        pbu = Point_Bot_User(pbs) #should only be used where user does not exists
            
        for kwargs in pbs.selectparameters():

            if kwargs['rewards_program_name'] == 'Mgm' and kwargs['run']==1:
                mb = MgmBot(pbs,  **kwargs)
                mb.mine_mgm_points()
                pbs.user_rewards_info_df = mb.pbs.user_rewards_info_df

            if kwargs['rewards_program_name'] == 'Marriott' and kwargs['run']==1:
                mb = MarriottBot(pbs,  **kwargs)
                mb.mine_hotel_stay_points()
                pbs.user_rewards_info_df = mb.pbs.user_rewards_info_df

            if kwargs['rewards_program_name'] == 'Hyatt' and kwargs['run']==1:
                mb = HyattBot(pbs,  **kwargs)
                mb.mine_hyatt_points()
                pbs.user_rewards_info_df = mb.pbs.user_rewards_info_df

            if kwargs['rewards_program_name'] == 'AmericanAirlines' and kwargs['run']==1:
                mb = AmericanAirlinesBot(pbs,  **kwargs)
                mb.mine_americanairlines_points()
                pbs.user_rewards_info_df = mb.pbs.user_rewards_info_df

            if kwargs['rewards_program_name'] == 'Delta' and kwargs['run']==1:
                mb = DeltaBot(pbs,  **kwargs)
                mb.mine_delta_points()
                pbs.user_rewards_info_df = mb.pbs.user_rewards_info_df

            if kwargs['rewards_program_name'] == 'Southwest' and kwargs['run']==1:
                sb = SouthwestBot(pbs, **kwargs)
                sb.mine_southwest_points()
                pbs.user_rewards_info_df = sb.pbs.user_rewards_info_df

            if kwargs['rewards_program_name'] == 'United' and kwargs['run']==1:
                ub = UnitedBot(pbs, **kwargs)
                ub.mine_united_points()
                pbs.user_rewards_info_df = ub.pbs.user_rewards_info_df

            if kwargs["rewards_program_name"] == "Test" and kwargs['run']==1:
                tb = TestBot(pbs, **kwargs)
                tb.mine_test_bot()

        pbs.closeoutfunction() #closes out per user at this level

    vds = VisualizeData(pbs,'jkail')
    vds.main()

    #display = Display(visible=0, size=(800, 600)) # damn this actually works
    #display.start() # damn this actually works
    # with Xvfb() as xvfb:# does not work on mac
    #display.stop()# damn this actually works
