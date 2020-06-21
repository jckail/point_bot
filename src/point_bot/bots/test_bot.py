from bots.base_bot import PointBotDriver
import re
from time import sleep
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
import pandas as pd
from selenium.webdriver.support import expected_conditions as EC
from datetime import datetime
import time


class TestBot(PointBotDriver):
    def __init__(
        self,
        pbs,
        point_bot_user=None,
        rewards_program_name=None,
        rewards_user_email=None,
        rewards_username = None,
        rewards_user_pw=None,
        timestr=None,
        start_url=None,
        datapath=None,
        decryptionkey = None,
        headless=True,
        **kwargs,
    ):

        self.pbs = pbs
        self.point_bot_user = point_bot_user
        self.rewards_program_name = rewards_program_name
        self.rewards_user_email = rewards_user_email
        self.rewards_username = rewards_username
        self.rewards_user_pw = rewards_user_pw
        self.run_timestr = timestr
        self.start_url = start_url
       
        self.botname = __class__.__name__
        self.datapath = datapath
        if self.datapath == None:
            self.datapath = f"data/botsdata/{self.botname.lower()}/"
        self.decryptionkey = decryptionkey
        self.headless = headless

        super().__init__(
            self.pbs,
            self.point_bot_user,
            self.rewards_program_name,
            self.rewards_user_email,
            self.rewards_username,
            self.rewards_user_pw,
            self.run_timestr,
            self.start_url,
            self.datapath,
            self.decryptionkey,
            self.headless,
            **kwargs,
        )

    def mine_test_bot(self):
        funcname = str(self.mine_test_bot.__name__)
        print(f"Starting: {self.botname} : {funcname}")
        try:
            self.startupdriver()
            kwargs = {
                "step1": {
                    "action": "redirect",
                    "description": "Testing Against Random Site",
                    "url": "https://intoli.com/blog/not-possible-to-block-chrome-headless/chrome-headless-test.html",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
                "step2": {
                    "action": "redirect",
                    "description": "Ip Location Test",
                    "url": "https://www.iplocation.net/",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
                "rawheaders": {
                    "action": "redirect",
                    "description": "rawheaders",
                    "url": "view-source:https://httpbin.org/headers",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
                "step7": {
                    "action": "redirect",
                    "description": "Chrome Headless",
                    "url": "https://arh.antoinevastel.com/bots/areyouheadless",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
                "step8": {
                    "action": "redirect",
                    "description": "Chrome Headless2",
                    "url": "https://antoinevastel.com/bots",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
                "last_step": {
                    "action": "last_step",
                    "description": "Last Step",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
            }

            time_track_dict = self.run_bot_function(
                botname=self.botname, funcname=funcname, **kwargs
            )

            bigspaces = "\n" * 3
            print(f"{bigspaces}   !GREAT SUCCESS!     {bigspaces}")
            if self.headless == False:
                print("Sleeping 30 Seconds")
                sleep(30)
            self.driver.quit()
        except Exception as e:
            print(e)
            print(f"{self.point_bot_user}_{self.botname}_{funcname} FAILED")
            self.driver.quit()


if __name__ == "__main__":
    from base_bot import PointBotDriver
    from ..point_bot_profile_parameters  import PointBotProfileParameters
    from ..setup_point_bot  import PointBotSetup
    pbs = PointBotSetup()
    pbs.start()
    headless = True
    print(f'\n\n\n Headless = {headless} \n\n\n ')
    for user in ["jkail"]: #"jkail", "ellen"
        pbp = PointBotProfileParameters(pbs,user)

        for kwargs in pbp.parameter_list:

            if kwargs["rewards_program_name"] == "Test":
                tb = TestBot(headless_input=headless, **kwargs)
                tb.mine_test_bot()
