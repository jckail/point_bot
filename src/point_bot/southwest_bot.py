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

class SouthwestBot(PointBotDriver):
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
    def collectandpaginate(self,time_track_dict, funcname, dflist=[], step =  0, **kwargs):
        time_track_dict, loginresult = self.run_bot_function(time_track_dict,
        botname=self.botname, funcname=funcname, **kwargs)
        df = pd.read_html(self.driver.page_source)[0] #this returns a list
        df.columns = [column.replace('sortable column  ','') for column in df.columns]
        dflist.append(df)
        headers = self.gen_soup().find_all("span", class_="pagination--total-pages",)
        pages = [x.text for x in headers][0]
        for x in range(1,int(pages)):
            kwargs ={
            f"step{str(step)}_page_{x}": {
                                "action": "click_text",
                                "description": "Paginating",
                                "argument_to_click": '//div[3]/div/button[2]',
                                "findby": By.XPATH,
                                "take_screenshot": 1,
                                "log_html": 1,
                                "capture_variable": "",
                                "output_capture": 1,
                            }
            }
            time_track_dict, loginresult = self.run_bot_function(time_track_dict,
                botname=self.botname, funcname=funcname, **kwargs)
            df = pd.read_html(self.driver.page_source)[0] #this returns a list
            df.columns = [column.replace('sortable column  ','') for column in df.columns]
            dflist.append(df)
        return time_track_dict, funcname,dflist

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
                    "description": "Entering Username",
                    "argument_to_click": "//input[@id='username']",
                    "findby": By.XPATH,
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
                    "description": "Submit Password",
                    "argument_to_click": '//*[@id="login-form--submit-button"]',
                    "findby": By.XPATH,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },

                "step5": {
                    "action": "login_test",
                    "description": "Ensure Login Worked",
                    "input_keys": "My Account",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                }}
            time_track_dict, loginresult = self.run_bot_function(
                botname=self.botname, funcname=funcname, **kwargs)
            #this is the page pagrination begins
            if loginresult:
                kwargs ={
                    "step6": {
                        "action": "redirect",
                        "description": "Going to Actitivty",
                        "url": "https://www.southwest.com/myaccount/rapid-rewards/recent-activity/details",
                        "take_screenshot": 1,
                        "log_html": 1,
                        "capture_variable": "",
                        "output_capture": 1,
                    },
                }
                
                time_track_dict, funcname, dflist = self.collectandpaginate(time_track_dict, funcname, dflist=[], step = 6, **kwargs)
                
                kwargs ={
                    "step7": {
                            "action": "click_text",
                            "description": "Paginating",
                            "argument_to_click": "date",
                            "findby": By.ID,
                            "take_screenshot": 1,
                            "log_html": 1,
                            "capture_variable": "",
                            "output_capture": 1,
                    },
                    "step8": {
                            "action": "click_text",
                            "description": "Paginating",
                            "argument_to_click": 'date-menu-item1',
                            "findby": By.ID,
                            "take_screenshot": 1,
                            "log_html": 1,
                            "capture_variable": "",
                            "output_capture": 1,
                    },
                }
                time_track_dict, funcname, dflist = self.collectandpaginate(time_track_dict, funcname, dflist,step=8, **kwargs)



                df = pd.concat(dflist)
                self.pbs.pbsavedf(f"{self.datapath}parsed/{self.point_bot_user}_southwest_points_parsed.json",df=df)
                
                
                
                bigspaces = "\n" * 3
                print(f"{bigspaces}   !GREAT SUCCESS!     {bigspaces}")
                if self.headless == False:
                    print("Sleeping 30 Seconds")
                    sleep(30)
                self.driver.quit()
            else:
                raise Exception(f"LOGIN FAILED {self.point_bot_user}_{self.botname}_{funcname} ")

        except Exception as e:
            print(e)
            print(f"{self.point_bot_user}_{self.botname}_{funcname} FAILED")
            self.driver.quit()


if __name__ == "__main__":
    sb = SouthwestBot("jkail")
    sb.mine_southwest_points()
