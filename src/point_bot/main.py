#!/usr/bin/env python3.8

import pandas as pd

from setup_point_bot import PointBotSetup
from pointbotencryption import PointBotEncryption
from fetch_profile import Point_Bot_User

from bots.marriott_bot import MarriottBot
from bots.southwest_bot import SouthwestBot
from bots.test_bot import TestBot
from visualize_data import VisualizeData

# from xvfbwrapper import Xvfb
# from pyvirtualdisplay import Display
#sudo apt install xvfb
#pip3.8 install xvfbwrapper

if __name__ == "__main__":
    headless = True # note pass headless to setup so we can record
    #pass users up here  ['jkail','chuck','alex','ellen']: #"jkail", "ellen"'chuck' 'jkail',
    pbs = PointBotSetup(headless = headless,offlinemode=0,runspecificbots = ['Marriott']) # ,runspecificbots = ['Southwest']
    pbs.start()
    print(f'\n\n\n Headless = {headless} \n\n\n ')

    pbu = Point_Bot_User(pbs)
        
    for kwargs in pbs.selectparameters():

        if kwargs['rewards_program_name'] == 'Marriott' and kwargs['run']==1:
            mb = MarriottBot(pbs,  **kwargs)
            mb.mine_hotel_stay_points()
            pbs.user_rewards_info_df = mb.pbs.user_rewards_info_df

        if kwargs['rewards_program_name'] == 'Southwest' and kwargs['run']==1:
            sb = SouthwestBot(pbs, **kwargs)
            sb.mine_southwest_points()
            pbs.user_rewards_info_df = sb.pbs.user_rewards_info_df

        if kwargs["rewards_program_name"] == "Test" and kwargs['run']==1:
            tb = TestBot(pbs, **kwargs)
            tb.mine_test_bot()

    pbs.closeoutfunction()
    vds = VisualizeData(pbs,'jkail')
    vds.main()

    #display = Display(visible=0, size=(800, 600)) # damn this actually works
    #display.start() # damn this actually works
    # with Xvfb() as xvfb:# does not work on mac
    #display.stop()# damn this actually works
