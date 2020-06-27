from base_bot import PointBotDriver

# from base_bot import PointBotDriver #when running __main__
import re
from time import sleep
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
import pandas as pd
from selenium.webdriver.support import expected_conditions as EC
from datetime import datetime
import time
from selenium.webdriver.common.keys import Keys
import pandas as pd

class AmericanAirlinesBot(PointBotDriver):
    def __init__(
        self,
        pbs,
        point_bot_user=None,
        rewards_program_name=None,
        rewards_user_email=None,
        rewards_username = None,
        rewards_user_pw=None,
        last_name = None,
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
        self.last_name = last_name
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
            self.last_name,
            self.run_timestr,
            self.start_url,
            self.datapath,
            self.decryptionkey,
            self.headless,
            **kwargs,
        )
    
    def mine_americanairlines_points(self):
        funcname = str(self.mine_americanairlines_points.__name__)
        print(f"Starting: {self.botname} : {funcname}")
        print(self.decrypt(self.rewards_user_pw))
        print(str(self.rewards_username))
        try:
            kwargs = {
                                "step1": {
                    "action": "click_text",
                    "description": "find Sign In",
                    "argument_to_click": "loginLogoutLink",
                    "findby": By.ID,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                "step2": {
                    "action": "click_text",
                    "description": "Entering Username",
                    "argument_to_click": "loginId",
                    "findby": By.ID,
                    "input_keys": str(self.rewards_username),
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                "step3": {
                    "action": "click_text",
                    "description": "Entering Password",
                    "argument_to_click": "password",
                    "findby": By.ID,
                    "input_keys": self.decrypt(self.rewards_user_pw),
                    #"input_keys2": Keys.ENTER,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                
                 "step4": {
                    "action": "click_text",
                    "description": "Entering Last Name",
                    "argument_to_click": "lastName",
                    "findby": By.ID,
                    "input_keys": self.last_name,
                    #"input_keys2": Keys.ENTER,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                "step5": {
                    "action": "click_text",
                    "description": "Submit Password",
                    "argument_to_click": "button_login",
                    "findby": By.ID,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
                    "step6": {
                        "action": "redirect",
                        "description": "Going to Actitivty",
                        "url": "https://www.americanairlines.com/acctactvty/manageacctactvty.action",
                        "take_screenshot": 1,
                        "log_html": 1,
                        "capture_variable": "",
                        "output_capture": 1,
                    },
                "step7": {
                    "action": "login_test",
                    "description": "Ensure Login Worked",
                    "input_keys": "Account Activity",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                }
                }
            time_track_dict, loginresult = self.run_bot_function(
                botname=self.botname, funcname=funcname, **kwargs)
                
                
                
            bigspaces = "\n" * 3
            print(f"{bigspaces}   !GREAT SUCCESS!     {bigspaces}")
            if self.headless == False:
                print("Sleeping 30 Seconds")
                sleep(300)
            self.driver.quit()
            # else:
            #     raise Exception(f"LOGIN FAILED {self.point_bot_user}_{self.botname}_{funcname} ")

        except Exception as e:
            print(e)
            print(f"{self.point_bot_user}_{self.botname}_{funcname} FAILED")
            self.driver.quit()


if __name__ == "__main__":
    sb = americanairlinesBot("jkail")
    sb.mine_americanairlines_points()