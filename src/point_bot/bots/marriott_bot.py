from bots.base_bot import PointBotDriver

# from base_bot2 import PointBotDriver #when running __main__

import re
from time import sleep
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
import pandas as pd
from selenium.webdriver.support import expected_conditions as EC
from datetime import datetime
import time
from selenium.webdriver.common.keys import Keys


class MarriottBot(PointBotDriver):
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
        self.rewards_username = rewards_username,
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

    def gen_activityfilter(self, go=0):
        # try:
        # soup = BeautifulSoup(self.driver.page_source, 'lxml')

        x = [
            tag.get("id")
            for tag in self.gen_soup().find_all(
                "div", id=re.compile("^ActivityFilter.*")
            )
        ]
        if x != []:
            print(f"Found!: {str(x[0])}")
            return str(x[0])
        # except:
        #     raise Exception('activityfilter not found in soup ')

    def parse_hotel_stay(self):
        ## put in checks at each step to ensure not off track
        ## put in checks at each step to ensure not off track
        my_list = self.gen_soup().find_all(
            "div", class_="tile-activity-grid l-m-container-fullbleed l-padding-none",
        )
        my_list = [x.text for x in my_list][0]
        for replacer in ["Posted ", "Type ", "Description", "Earnings    ", "\xa0"]:
            my_list = my_list.replace(replacer, "")
        out_list1 = []
        my_list = list(my_list.split("Hotel Stay*"))
        for x in my_list:
            x = x.split("  ")[1:5]
            out_list1.append(x)
        out_list1 = out_list1[1:]
        out_list3 = []
        for x in out_list1:
            out_list2 = []
            for item in x:
                match = re.search(r"(\d+/\d+/\d+)", item)
                if match != None:
                    match = str((match.group(1)))
                    match2 = re.search(r"(\d+/\d+/\d+)", item.replace(match, ""))
                    match2 = str((match2.group(1)))
                    item = item.replace(f" {match} - {match2}", "")
                    out_list2.append(item)
                    out_list2.append(match)
                    out_list2.append(match2)
                else:
                    item = item
                    out_list2.append(item)
            out_list3.append(out_list2)
        pointslist = []

        for x in out_list3:
            rowout = x[:3]
            z = x[5]
            z = z.replace(")", "")
            z = z.replace(" + ", "+")
            z = z.replace(" (", "+")
            z = z.replace(",", "")
            for y in z.split("+")[1:]:
                rowout.append(
                    y.split(" ")[0]
                )  # appends only the first value in list aka points int
            pointslist.append(rowout)

        headers = [
            "hotel",
            "start_date",
            "end_date",
            "total_points",
            "base",
            "elite",
            "extra",
        ]
        df = pd.DataFrame(pointslist)
        df.columns = headers
        df["timestr"] = self.run_timestr
        df["point_bot_user"] = self.point_bot_user
        df["rewards_email"] = self.rewards_user_email
        df_dict = df.to_dict(orient="records")
        df.to_json(
            f"{self.datapath}parsed/{self.point_bot_user}_marriott_points_parsed.json",
            orient="records",
            indent=4,
        )
        return df_dict

    def mine_hotel_stay_points(self):
        funcname = str(self.mine_hotel_stay_points.__name__)
        print(f"Starting: {self.botname} : {funcname}")
        #print(self.decrypt("gAAAAABe4SSRRb6euQwnm-VHmJhigLZxRcgtmUPPOs-6UhPfZVj6Kjjhx48JsmGNiy_VZQgNYp4rzaVtAMC-7fWjUz4i36RT4A=="))
        try:

            kwargs = {
                "step1": {
                    "action": "click_text",
                    "description": "find Sign In",
                    "argument_to_click": "Sign In or Join",
                    "findby": By.LINK_TEXT,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 0,
                },
                "step2": {
                    "action": "click_text",
                    "description": "Input Username",
                    "argument_to_click": '//*[@id="user-id"]',
                    "findby": By.XPATH,
                    "input_keys": self.rewards_user_email,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step3": {
                    "action": "click_text",
                    "description": "Input Password",
                    "argument_to_click": '//*[@id="password"]',
                    "findby": By.XPATH,
                    "input_keys": self.decrypt(self.rewards_user_pw),
                    # "input_keys2": Keys.ENTER,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step4": {
                    "action": "click_text",
                    "description": "Submit form",
                    "argument_to_click": "//button[@name='submitButton']",
                    "findby": By.XPATH,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
            }
 
            time_track_dict = self.run_bot_function(
                botname=self.botname, funcname=funcname, **kwargs)

            # if 1 == input('input to unpause'):
            #     pass           
            
            kwargs = {
                "step5": {
                    "action": "login_test",
                    "description": "Ensure Login Worked",
                    "input_keys": "My Trips",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step6": {
                    "action": "redirect",
                    "description": "Hotel Stay data",
                    "url": "https://www.marriott.com/loyalty/myAccount/activity.mi?activityType=stay&monthsFilter=24",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
            }

            time_track_dict = self.run_bot_function(time_track_dict,
                botname=self.botname, funcname=funcname, **kwargs
            )

            kwargs = {
                "step7": {
                    "action": "click_text",
                    "description": "Filter Actitivty",
                    "argument_to_click": f"//div[@id='{self.gen_activityfilter()}']/div/div/div[2]",
                    "findby": By.XPATH,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step8": {
                    "action": "click_text",
                    "description": "Select 5 Records",
                    "argument_to_click": "selectric-opt01",
                    "findby": By.ID,
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step9": {
                    "action": "last_step",
                    "description": "Last Step",
                    "take_screenshot": 1,
                    "log_html": 1,
                    "capture_variable": "",
                    "output_capture": 1,
                },
            }
            time_track_dict = self.run_bot_function(
                time_track_dict, botname=self.botname, funcname=funcname, **kwargs
            )
            # create general action so can pass records per page, total records, does math of pagnations and just needs to know which is next button
            # for page in pages (lenght) [x.text for x in headers][0].replace('total','').replace(' ','')
            headers = self.gen_soup().find_all(
                "div", class_="m-pagination-total-items t-color-standard-90"
            )
            try:
                print(
                    "total records ",
                    [x.text for x in headers][0].replace("total", "").replace(" ", ""),
                )
            except Exception as e:
                print(e)
                print("no pagnation")
            ##todo pagnate the page create loop #append start and end then add iteration to string
            time_track_dict[f"start_8"] = str(datetime.now())

            try:
                self.parse_hotel_stay()
            except Exception as e:
                print(e)
                print("no hotel_stay")
                raise Exception("no hotel_stay")

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
    mb = MarriottBot("jkail", pw="GTFO", headless=True)
    mb.mine_hotel_stay_points()
    # print(mb.df_rewards_user)
    # print(mb.df_rewards_user.iloc[0]["rewards_user_email"])
    # print(mb.gen_soup())
