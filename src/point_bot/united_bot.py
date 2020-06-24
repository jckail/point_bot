from base_bot import PointBotDriver

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
from re import search
from united_security_questions import UnitedSecurityQuestions


class UnitedBot(PointBotDriver):
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
        self.usq = UnitedSecurityQuestions(pbs)


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

    def evaluate_questions(self,question):
        for user_question in self.usq.current_security_questions_df.columns:
            user_answer = self.usq.current_security_questions_df[user_question].tolist()[0]

            
            print('user_question ',user_question)
            print('question ',question)
            print('user_answer ',user_answer)

            if  search(user_question, question):
                return user_answer



    def mine_united_points(self):
        funcname = str(self.mine_united_points.__name__)
        print(f"Starting: {self.botname} : {funcname}")
        print(self.usq.current_security_questions_df)
        try:

            kwargs = {
                "step1": {
                    "action": "click_text",
                    "description": "find Sign In",
                    "argument_to_click": "//li[5]/div/div/button/span",
                    "findby": By.XPATH,
                    "take_screenshot": 0,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 0,
                },
                "step2": {
                    "action": "click_text",
                    "description": "Input Username",
                    "argument_to_click": "//input[@name='loginFormPage.mpInput']",
                    "findby": By.XPATH,
                    "input_keys": self.rewards_username,
                    "take_screenshot": 0,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step3": {
                    "action": "click_text",
                    "description": "Input Password",
                    "argument_to_click": "//input[@id='passwordInput-3']",
                    "findby": By.XPATH,
                    "input_keys": self.decrypt(self.rewards_user_pw),
                    # "input_keys2": Keys.ENTER,
                    "take_screenshot": 0,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
                "step4": {
                    "action": "click_text",
                    "description": "Submit form",
                    "argument_to_click": "//form/button/span",
                    "findby": By.XPATH,
                    "take_screenshot": 0,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 1,
                },
            }
            
            
            time_track_dict, loginresult = self.run_bot_function(
                botname=self.botname, funcname=funcname,islogin = 1, **kwargs)
            self.pbs.pbsavefile(f"{self.datapath}raw_html/{'finddatahere'}_{'finddatahere'}.html",self.driver.page_source,writetype='w+')    
            x = self.gen_soup().body.findAll(text='To confirm your identity, please answer the following security questions:')
            questionlist = self.gen_soup().find_all("legend", class_="labelStyle",)
            print(questionlist)
            iteration = 0
            
            for num in questionlist:

                answer = self.evaluate_questions(str(num.text))

                idofselect = f'QuestionsList_{iteration}__AnswerKey'
                # x = self.gen_soup().body.findAll(id=idofselect)
                # print(x)

                el = self.driver.find_element_by_id(idofselect)
                for option in el.find_elements_by_tag_name('option'):
                    print(option.text)
                    if option.text.lower() == answer.lower():
                        option.click() # select() in earlier versions of webdriver
                        print('got ya bitch')
                        break
                iteration += 1

            #sleep(10)
            kwargs = {
                "step5": {
                    "action": "click_text",
                    "description": "find Sign In",
                    "argument_to_click": '//*[@id="authQuestionsForm"]/div[5]/div/label',
                    "findby": By.XPATH,
                    "take_screenshot": 0,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 0,
                },
                                "step6": {
                    "action": "click_text",
                    "description": "find Sign In",
                    "argument_to_click": "btnNext",
                    "findby": By.ID,
                    "take_screenshot": 0,
                    "log_html": 1,
                    "capture_variable": "datalayer",
                    "output_capture": 0,
                },
                        "step7": {
                        "action": "redirect",
                        "description": "Hotel Stay data",
                        "url": f"https://www.united.com/en/us/account/activity",
                        "take_screenshot": 1,
                        "log_html": 1,
                        "capture_variable": "datalayer",
                        "output_capture": 1,
                    },
                
                }

            time_track_dict, loginresult = self.run_bot_function(time_track_dict,
                botname=self.botname, funcname=funcname, **kwargs
            )

            bigspaces = "\n" * 3
            print(f"{bigspaces}   !GREAT SUCCESS!     {bigspaces}")
            if self.headless == False:
                print("Sleeping 300 Seconds")
                sleep(300)
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
