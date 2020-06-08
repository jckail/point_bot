#!/usr/bin/env python3.8

import pandas as pd
from fetch_profile import Point_Bot_User
from point_bot_profile_parameters import PointBotProfileParameters
from setup_point_bot import PointBotSetup

from bots.marriott_bot import MarriottBot
from bots.southwest_bot import SouthwestBot
from bots.test_bot import TestBot

# from xvfbwrapper import Xvfb
# from pyvirtualdisplay import Display
#sudo apt install xvfb
#pip3.8 install xvfbwrapper

if __name__ == "__main__":
    pbs = PointBotSetup()
    pbs.start()
    headless = True
    print(f'\n\n\n Headless = {headless} \n\n\n ')
    #display = Display(visible=0, size=(800, 600)) # damn this actually works
    #display.start() # damn this actually works
    # with Xvfb() as xvfb:# does not work on mac
    # pbu = Point_Bot_User()
    for user in [ "jkail"]: #"jkail", "ellen"
        pbp = PointBotProfileParameters(pbs,user)

        # this is where you would create async bots!
        # CAN WRITE LAMBDA TO FIND KEYS
        for kwargs in pbp.parameter_list:
            #print(kwargs)
            
            if kwargs['rewards_program_name'] == 'Marriott':
                mb = MarriottBot(headless_input = headless, **kwargs)
                mb.mine_hotel_stay_points()

            if kwargs['rewards_program_name'] == 'Southwest':
                sb = SouthwestBot(headless_input = headless, **kwargs)
                sb.mine_southwest_points()

            if kwargs["rewards_program_name"] == "Test":
                tb = TestBot(headless_input=headless, **kwargs)
                tb.mine_test_bot()

    #display.stop()# damn this actually works
