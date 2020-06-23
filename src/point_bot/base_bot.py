import os
import sys
import undetected_chromedriver as uc
#chrome_driver_path = f"{os.getcwd()}/chromedriver_j"
#uc.install(executable_path=chrome_driver_path)
uc.TARGET_VERSION = 83  #this is what was fucking u
uc.install() #important this is first
from time import sleep
#from selenium import webdriver
from selenium.webdriver import Chrome, ChromeOptions
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver import ActionChains
from pointbotencryption import PointBotEncryption
from selenium.webdriver.common.keys import Keys
from datetime import datetime
from bs4 import BeautifulSoup
import pandas as pd
import json
from datetime import datetime
import time
import random
from io import BytesIO

#import random_user_agent ### could use random agent


class PointBotDriver:
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
            self.headless_text = '_hl'
        else:
            self.headless_text = ''
        d = DesiredCapabilities.CHROME
        d['goog:loggingPrefs']={'performance':'ALL'}

        chrome_options = ChromeOptions()
        chrome_options.headless = self.headless
        #chrome_options.add_argument("--incognito")
        #chrome_options.add_argument('--disable-extensions')
        chrome_options.add_argument("--start-maximized")
        #chrome_options.add_argument("--window-size=1920x1080")
        user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.61 Safari/537.36'
        chrome_options.add_argument(f'user-agent={user_agent}')
        chromedriverpath = f"{os.getcwd()}/chromedriver"
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)

        self.pbs.user_rewards_info_df['user_agent'] = user_agent
        print('Chrome Options: ',chrome_options.arguments, '\n Chrome Driver Path: ',chromedriverpath)
        self.driver = Chrome(chrome_options=chrome_options,desired_capabilities=d)
        self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": """
            Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
            })
        """
        })
        # self.driver.execute_cdp_cmd("Network.enable", {})
        # self.driver.execute_cdp_cmd("Network.setExtraHTTPHeaders", {"headers": {"User-Agent": "browser1"}})
        
        #examples of cdp
        original_user_agent_string = self.driver.execute_script( "return navigator.userAgent")
        # print('original user agent: ', original_user_agent_string)
        self.driver.execute_cdp_cmd(
            "Network.setUserAgentOverride",
            {
                "userAgent": original_user_agent_string.replace("Headless", ""),
                "platform": "MacIntel",
            },
        )
        # new_user_agent_string = self.driver.execute_script( "return navigator.userAgent")
        # print(f'\n\n\n{original_user_agent_string}\n\n\n')
        # print(f'\n\n\n{new_user_agent_string}\n\n\n')

        self.max_attempts = 3 

    def decrypt(self,stringtodecrypt):
        return PointBotEncryption(self.pbs,keyfilename=self.decryptionkey).decrypt_string(stringtodecrypt.encode())
    def startupdriver(self,url=None,previouspage='https://www.google.com/'):
        if url== None:
            url = self.start_url
        #self.driver.get('https://www.google.com/')
        self.driver.maximize_window()
        self.driver.get(url)
        sleep(random.uniform(2.1, 5))
        
        

    def gen_soup(self):
        self.soup = BeautifulSoup(self.driver.page_source, 'lxml')
        return self.soup

    def exist_test(self,soup, input_keys='None',**kwargs):
        test = soup.body.findAll(text=input_keys)
        if len(test) > 0:
            print(f'\n\n\n Login Success ({test} len {len(test)})\n\n\n')
            return True
        else:
            print(f'\n\n\n Login failed ({test} len {len(test)})\n\n\n')
            return False

    def move_n_click(self,element):
        actionx = ActionChains(self.driver).move_to_element(element)#.click()
        sleep(random.uniform(0.1, 1.5))
        actionx.perform()
        sleep(random.uniform(0.1, .8))
        actionx.click().perform()
        

    def sleep_keys(self,element,input_keys):
        input_keys = str(input_keys)
        for character in input_keys:
            speed = random.uniform(0.1, .5)
            sleep(speed)
            element.send_keys(character)

    def click_text(self, argument_to_click, findby, input_keys = None, input_keys2 = None, description = '', action=None, attempts = 0, datalayer=None,**kwargs):
        attempts += 1
        try:
            if attempts <= self.max_attempts:
                try:
                    element = WebDriverWait(self.driver, 10).until(
                        EC.element_to_be_clickable((findby, argument_to_click))
                    )
                    if input_keys != None:
                        self.move_n_click(element)
                        sleep(random.uniform(0.1, 1.5))
                        self.sleep_keys(element,input_keys)
                        if input_keys2 != None:
                            self.sleep_keys(element,input_keys2)
                            
                    else:
                        self.move_n_click(element)
                    
                    print(f"{description} --Complete-- ")
                    return self.driver

                except Exception as e:
                    print(e)
                    print(f"{description} Failed RETRYING . . . attempt: {attempts} / {self.max_attempts}")
                    print(f'argument_to_click: "{argument_to_click}" not avalible via {findby}')
                    if attempts <= self.max_attempts:
                        return self.click_text(
                            argument_to_click, findby, attempts=attempts
                        )
            else:
                raise Exception(f"TOO MANY FAILED ATTEMPTS: {self.max_attempts}")
        except Exception as e:
            print(e)

    def screenshot(self,filename,when):
        S = lambda X: self.driver.execute_script('return document.body.parentNode.scroll'+X)
        self.driver.set_window_size(S('Width'),S('Height')) # May need manual adjustment 
        pngfile = f"{self.datapath}screencaps/{filename}_{when}.png"
        if self.pbs.offlinemode == 1:                                                                                                               
            self.driver.find_element_by_tag_name('body').screenshot(pngfile)
        else:
            screenshotx = self.driver.find_element_by_tag_name('body').screenshot_as_png
            databuffer = BytesIO(screenshotx)
            self.pbs.pbsaves3(pngfile,databuffer.getvalue())

    def savehtml(self,filename,when):
        self.pbs.pbsavefile(f"{self.datapath}raw_html/{filename}_{when}.html",self.driver.page_source,writetype='w+')
    
    #this was on marriott datalayer
    # def capturevariable(self,filename,when,capture_variable):
    #     with open(f"{self.datapath}dataLayer/{filename}_{capture_variable}_{when}.json", 'w+') as fp:
    #         capture_variable = f'return {capture_variable};'
    def modify_user_rewards_info_df(self,loginresult):
        if loginresult:
            self.pbs.user_rewards_info_df.loc[
                (self.pbs.user_rewards_info_df.point_bot_user == self.point_bot_user) & 
                (self.pbs.user_rewards_info_df.rewards_program_name == self.rewards_program_name) &
                (self.pbs.user_rewards_info_df.rewards_user_email == self.rewards_user_email) &
                (self.pbs.user_rewards_info_df.rewards_username == self.rewards_username) & 
                (self.pbs.user_rewards_info_df.rewards_user_pw == self.rewards_user_pw)& 
                (self.pbs.user_rewards_info_df.timestr == self.run_timestr),
                'last_successful_login_run_timestr' ] = str(self.run_timestr)

            self.pbs.user_rewards_info_df.loc[
                (self.pbs.user_rewards_info_df.point_bot_user == self.point_bot_user) & 
                (self.pbs.user_rewards_info_df.rewards_program_name == self.rewards_program_name) &
                (self.pbs.user_rewards_info_df.rewards_user_email == self.rewards_user_email) &
                (self.pbs.user_rewards_info_df.rewards_username == self.rewards_username) & 
                (self.pbs.user_rewards_info_df.rewards_user_pw == self.rewards_user_pw)& 
                (self.pbs.user_rewards_info_df.timestr == self.run_timestr),
                'last_successful_login_time' ] = str(datetime.now())

            self.pbs.user_rewards_info_df.loc[
                (self.pbs.user_rewards_info_df.point_bot_user == self.point_bot_user) & 
                (self.pbs.user_rewards_info_df.rewards_program_name == self.rewards_program_name) &
                (self.pbs.user_rewards_info_df.rewards_user_email == self.rewards_user_email) &
                (self.pbs.user_rewards_info_df.rewards_username == self.rewards_username) & 
                (self.pbs.user_rewards_info_df.rewards_user_pw == self.rewards_user_pw)& 
                (self.pbs.user_rewards_info_df.timestr == self.run_timestr),
                'times_accessed' ] += 1

            self.pbs.user_rewards_info_df.loc[
                (self.pbs.user_rewards_info_df.point_bot_user == self.point_bot_user) & 
                (self.pbs.user_rewards_info_df.rewards_program_name == self.rewards_program_name) &
                (self.pbs.user_rewards_info_df.rewards_user_email == self.rewards_user_email) &
                (self.pbs.user_rewards_info_df.rewards_username == self.rewards_username) & 
                (self.pbs.user_rewards_info_df.rewards_user_pw == self.rewards_user_pw)& 
                (self.pbs.user_rewards_info_df.timestr == self.run_timestr),
                'valid' ] = 1
        else:
            self.pbs.user_rewards_info_df.loc[
                (self.pbs.user_rewards_info_df.point_bot_user == self.point_bot_user) & 
                (self.pbs.user_rewards_info_df.rewards_program_name == self.rewards_program_name) &
                (self.pbs.user_rewards_info_df.rewards_user_email == self.rewards_user_email) &
                (self.pbs.user_rewards_info_df.rewards_username == self.rewards_username) & 
                (self.pbs.user_rewards_info_df.rewards_user_pw == self.rewards_user_pw)& 
                (self.pbs.user_rewards_info_df.timestr == self.run_timestr),
                'valid' ] = 0

    def performaction(self, action, step,filename, **kwargs):
            log_list = []
            loginresult = True
            log_list.append({'browser_start':self.driver.get_log('browser')})
            log_list.append({'driver_start':self.driver.get_log('driver')})
            
            if action == 'click_text':
                self.click_text(**kwargs[step])

            if action == 'exist_test':
                loginresult = self.exist_test(self.gen_soup(),**kwargs[step])

            if action == 'login_test':
                loginresult = self.exist_test(self.gen_soup(),**kwargs[step])
                self.modify_user_rewards_info_df(loginresult)

            if action == 'redirect':
                sleep(random.uniform(2.1, 3.0))
                'Redirecting to: '+kwargs[step]['url']
                self.driver.get(kwargs[step]['url'])
                sleep(random.uniform(2.5, 3.5))
                
            log_list.append({'browser_after':self.driver.get_log('browser')})
            log_list.append({'driver_after':self.driver.get_log('driver')})
            res = {k: v for d in log_list for k, v in d.items()} 
            df = pd.DataFrame(res.items(), columns=['event', 'log_value'])


            self.pbs.pbsavedf(f"{self.datapath}console_logger/{filename}_logger.json",df)

            return log_list,loginresult

    def actions(self, time_track_dict, take_screenshot=1, log_html=1, output_capture = 0, capture_variable = "", **kwargs):
        loginresult = True
        for step in kwargs.keys():
            desc = kwargs[step]['description']
            print(f'\n{self.point_bot_user} {step}: {desc}')
            when = 'before'
            action = kwargs[step]['action']
            capture_variable = kwargs[step]['capture_variable']
            output_capture = kwargs[step]['output_capture']
            time_track_dict[f'start_{step}'] = str(datetime.now())

            filename = f"{time_track_dict['file_prefix']}_{step}{self.headless_text}"
            
            if take_screenshot == 1:
                self.screenshot(filename,when)
                
            if log_html ==1:
                self.savehtml(filename,when)

            # if capture_variable != "":
            #     self.capturevariable(filename,when,capture_variable)

            log_list,loginresult = self.performaction(action, step, filename, **kwargs)
            when = 'after'
            if take_screenshot == 1 and output_capture == 1:
                self.screenshot(filename,when)

            if log_html ==1 and output_capture == 1:
                self.savehtml(filename,when)
            
            # if capture_variable != "" and output_capture == 1:
            #     self.capturevariable(filename,when,capture_variable)

            time_track_dict[f'end_{step}'] = str(datetime.now())


        return time_track_dict, loginresult
    def start_time_tracking(self,file_prefix,botname,funcname):
        return  {
                    "run_timestr" : self.run_timestr,
                    "point_bot_user":self.point_bot_user,
                    "file_prefix":file_prefix,
                    "headless":self.headless,
                    "botname": botname,
                    "funcname": funcname,
                    "start_function": str(datetime.now()),
                }


    def stop_time_tracking(self,time_track_dict):
        time_track_dict[f"end_function"] = str(datetime.now())
        timetrackfile = f"{self.datapath}tracking_data/{time_track_dict['file_prefix']}.json"
        self.pbs.pbsavedf(timetrackfile,df=pd.DataFrame([time_track_dict]))

    def updateuserprofile(self):
        df = self.pbs.pbloaddf(self.pbs.unique_user_file)
        print(self.pbs.user_rewards_info_df )
        #if login sucessful updates that record
        #updates larger rewards info df with a good or bad login scructure update

    def botlogin(self):
        self.startupdriver()
        #create timedict
        # pass kwargs load via xbot_login.json
        # #function =  login
        # call run_bot_function    for logins   


    def run_bot_function(self,time_track_dict = None, botname='',funcname='',islogin=0, **kwargs):
        try:
            
            file_prefix = f"{self.point_bot_user}_{botname}_{funcname}"
            if time_track_dict == None:
                self.startupdriver()
                time_track_dict=  self.start_time_tracking(file_prefix,botname,funcname)

            time_track_dict,loginresult = self.actions(time_track_dict, **kwargs)
            
            if  'last_step' in kwargs.keys():
                self.stop_time_tracking(time_track_dict)
            #if loginresult == True and islogin == 1 : # then append userconfig with succesfull login
            #where rewardprogram = rewardprogram, userid= userid, email = email, pw = pw
                #print(self.pbs.unique_user_file,loginresult,self.point_bot_user,self.rewards_program_name,self.rewards_user_email,self.rewards_username,self.rewards_user_pw)
                
            return time_track_dict,loginresult

        except Exception as e:
            print(e)
            print(f"{self.point_bot_user}_{botname}_{funcname} FAILED")
            raise Exception(f"{self.point_bot_user}_{botname}_{funcname} FAILED")

    def getloopnumber(self,totalrecords,recordsperpage):
        loops = totalrecords // recordsperpage 
        if totalrecords % recordsperpage > 0:
            loops += 1
        return range(1,loops)


if __name__ == "__main__":
    url = 'https://www.marriott.com/default.mi'
    pbd = PointBotDriver('jkail',url)
    pbd.startupdriver()