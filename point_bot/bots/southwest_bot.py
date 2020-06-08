from bots.base_bot import PointBotDriver

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


class SouthwestBot(PointBotDriver):
    def __init__(
        self,
        point_bot_user=None,
        rewards_program_name=None,
        rewards_user_email=None,
        rewards_user_pw=None,
        timestr=None,
        start_url=None,
        datapath=None,
        headless_input=True,
        **kwargs,
    ):
        self.point_bot_user = point_bot_user
        self.rewards_program_name = rewards_program_name
        self.rewards_user_email = rewards_user_email
        self.rewards_user_pw = rewards_user_pw
        self.run_timestr = timestr
        self.start_url = start_url
        self.headless_input = headless_input
        self.botname = __class__.__name__
        self.datapath = datapath
        if self.datapath == None:
            self.datapath = f"data/botsdata/{self.botname.lower()}/"
        super().__init__(
            self.point_bot_user,
            self.rewards_program_name,
            self.rewards_user_email,
            self.rewards_user_pw,
            self.run_timestr,
            self.start_url,
            self.datapath,
            self.headless_input,
            **kwargs,
        )

    def mine_southwest_points(self):
        funcname = str(self.mine_southwest_points.__name__)
        print(f"Starting: {self.botname} : {funcname}")
        try:

            kwargs = {
                "step1": {
                    "action": "click_text",
                    "description": "find Sign In",
                    "argument_to_click": "(//button[@type='button'])[2]",
                    "findby": By.XPATH,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                "step2": {
                    "action": "click_text",
                    "description": "Input Username",
                    "argument_to_click": "//input[@id='username']",
                    "findby": By.XPATH,
                    "input_keys": self.rewards_user_email,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                "step3": {
                    "action": "click_text",
                    "description": "Input Password",
                    "argument_to_click": "//input[@id='password']",
                    "findby": By.XPATH,
                    "input_keys": self.rewards_user_pw,
                    "input_keys2": Keys.ENTER,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                #     "step4": {
                #     "action": "click_text",
                #     "description": "Submit Password",
                #     "argument_to_click": "Log in",
                #     "findby": By.LINK_TEXT,
                #     "take_screenshot": 1,
                #     "log_html": 1,2
                #     "capture_variable": "",
                #     "output_capture": 0,
                # },
                # "step4": {
                #     "action": "click_text",
                #     "description": "Submit Password",
                #     "argument_to_click": '//*[@id="login-form--submit-button"]',
                #     "findby": By.XPATH,
                #     "take_screenshot": 1,
                #     "log_html": 1,
                #     "capture_variable": "",
                #     "output_capture": 0,
                # },
                "step5": {
                    "action": "redirect",
                    "description": "Going to Actitivty",
                    "url": "https://www.southwest.com/myaccount/rapid-rewards/recent-activity/details",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                "step6": {
                    "action": "login_test",
                    "description": "Ensure Login Worked",
                    "input_keys": "My Account",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 0,
                },
                # "step7": {
                #     "action": "last_step",
                #     "description": "Last Step",
                #     "take_screenshot": 1,
                #     "log_html": 1,
                #     "capture_variable": "",
                #     "output_capture": 0,
                # },
            }
            self.run_bot_function(botname=self.botname, funcname=funcname, **kwargs)

            bigspaces = "\n" * 3
            print(f"{bigspaces}   !GREAT SUCCESS!     {bigspaces}")
            if self.headless_input == False:
                print("Sleeping 30 Seconds")
                sleep(30)
            self.driver.quit()

        except Exception as e:
            print(e)
            print(f"{self.point_bot_user}_{self.botname}_{funcname} FAILED")
            self.driver.quit()


if __name__ == "__main__":
    sb = SouthwestBot("jkail")
    sb.mine_southwest_points()
